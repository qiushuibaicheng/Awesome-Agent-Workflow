import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectService } from "../../project/service.ts";
import type { HostService } from "../../host/service.ts";
import {
  checkToolProject, createToolProject, toolProjectIdFromWish,
  type ToolProjectCheck, type ToolProjectIO,
} from "../runtime/project.ts";
import { acceptedMessage, repairMessage, wishMessage } from "../runtime/guide.ts";
import type { ToolPackage } from "../types.ts";

/** 一轮最多几次自动回灌。超过就把问题摊给用户——AI 卡住时人得能接管。 */
const maxRepairRounds = 3;

export function projectIO(host: HostService): ToolProjectIO {
  return {
    userDataDir: (namespace, directory) => host.skills.userDataDir(namespace, directory),
    pathExists: (path) => host.skills.pathExists(path),
    listDirNames: (path) => host.skills.listDirNames(path),
    readTextFile: (path) => host.archives.readTextFile(path),
    writeTextFile: (path, contents) => host.skills.writeTextFile(path, contents),
  };
}

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export interface ToolWishState {
  readonly wish: string;
  readonly setWish: (value: string) => void;
  readonly parent: string | null;
  readonly chooseParent: () => Promise<void>;
  readonly resetParent: () => void;
  readonly projectDir: string | null;
  readonly check: ToolProjectCheck | null;
  readonly note: { text: string; error?: true } | null;
  readonly busy: boolean;
  readonly start: () => Promise<void>;
  readonly verify: () => Promise<ToolProjectCheck | null>;
  readonly installed: boolean;
  readonly install: () => Promise<boolean>;
}

/**
 * 许愿流的状态与动作：建项目 → 开会话 → 自动校验 → 回灌。
 *
 * 校验是**在 AI 停下来之后**做的：订阅前台会话的 `isAgentRunning`，从 true 变
 * false 就检查一遍目录。这样用户不需要知道"该校验了"——他只说一句话，剩下的
 * 搬运由平台做。
 */
export function useToolWish({
  project, host, owner, onAccept, onInstalled,
}: {
  project?: ProjectService;
  host: HostService;
  /** 当前账号 id；默认目录按它分一层，和安装记录保持同一维度。 */
  owner?: string;
  /** 真正写入工具注册表的动作（由调用方注入，钩子不直接依赖 service）。 */
  onAccept?: (tool: ToolPackage) => void;
  onInstalled?: () => void;
}): ToolWishState {
  const [wish, setWish] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [check, setCheck] = useState<ToolProjectCheck | null>(null);
  const [note, setNote] = useState<{ text: string; error?: true } | null>(null);
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState(false);
  const rounds = useRef(0);
  const io = useRef(projectIO(host));

  const verify = useCallback(async () => {
    if (!projectDir) return null;
    try {
      const result = await checkToolProject(io.current, projectDir);
      setCheck(result);
      return result;
    } catch (error) {
      setNote({ text: errorText(error), error: true });
      return null;
    }
  }, [projectDir]);

  // AI 停下来就校验；有问题就把问题当成下一条消息发回去。
  useEffect(() => {
    if (!project || !projectDir) return;
    const session = project.conversation.foreground.session;
    let running = session.getState().isAgentRunning;
    return session.subscribe((state) => {
      const stopped = running && !state.isAgentRunning;
      running = state.isAgentRunning;
      if (!stopped) return;
      void (async () => {
        let result: ToolProjectCheck;
        try { result = await checkToolProject(io.current, projectDir); }
        catch (error) { setNote({ text: errorText(error), error: true }); return; }
        setCheck(result);
        if (result.ready) {
          rounds.current = 0;
          setNote({ text: result.warnings.length
            ? `校验通过（${result.warnings.length} 条建议）。可以预览验收了。`
            : "校验通过，可以预览验收了。" });
          return;
        }
        if (!result.tool || rounds.current >= maxRepairRounds) {
          setNote({
            text: `还有 ${result.blocking.length} 个问题没修好，已经试了 ${maxRepairRounds} 轮。可以把下面的问题直接发给 AI 继续。`,
            error: true,
          });
          return;
        }
        const target = {
          workspacePath: projectDir,
          agentKey: project.sessions.catalog.getState().agentKey ?? "",
          sessionId: project.conversation.foreground.session.getState().activeSessionId,
        };
        if (!target.agentKey) {
          setNote({ text: "会话还没连上 Agent，无法自动回灌。请手动把校验问题发给 AI。", error: true });
          return;
        }
        rounds.current += 1;
        project.conversation.send(target, repairMessage(result.blocking));
        setNote({ text: `发现问题，已回给 AI 修（第 ${rounds.current} 轮）。` });
      })();
    });
  }, [project, projectDir]);

  const start = useCallback(async () => {
    if (!project || !wish.trim() || busy) return;
    setBusy(true);
    setNote(null);
    setInstalled(false);
    setCheck(null);
    rounds.current = 0;
    try {
      const name = wish.trim().slice(0, 24);
      const wanted = toolProjectIdFromWish(wish.trim());
      const created = await createToolProject(io.current, {
        id: wanted, name, parent: parent ?? undefined, owner,
      });
      // 同名目录已存在时会自动退到 -2，得让用户知道"不是覆盖，是新建了一份"。
      const renamed = created.id === wanted ? "" : `已有同名项目，这次建成了 ${created.id}。`;
      setProjectDir(created.dir);
      project.projects.registerProject(created.dir);
      project.projects.selectWorkspace(created.dir);
      const started = await project.sessions.startNewSession(created.dir);
      if (!started.ok) {
        setNote({ text: `${renamed}项目已建好，但会话没连上（${started.reason}）。稍后可在会话面板重试。`, error: true });
        return;
      }
      const target = {
        workspacePath: created.dir,
        agentKey: project.sessions.catalog.getState().agentKey ?? "",
        sessionId: project.conversation.foreground.session.getState().activeSessionId,
      };
      if (target.agentKey) {
        project.conversation.send(target, wishMessage(wish.trim(), created));
        setNote({ text: `${renamed}会话已开始，AI 写完后我会自动校验。` });
      } else {
        setNote({ text: `${renamed}会话已建好，但还没连上 Agent。连上后把这句话发给它即可（项目里的 AGENTS.md 就是规范）。` });
      }
    } catch (error) {
      setNote({ text: errorText(error), error: true });
    } finally {
      setBusy(false);
    }
  }, [busy, owner, parent, project, wish]);

  const install = useCallback(async () => {
    if (!projectDir) return false;
    const result = await verify();
    if (!result?.ready || !result.tool) {
      setNote({ text: "还有必须修的问题，先让 AI 修完再安装。", error: true });
      return false;
    }
    try {
      onAccept?.(result.tool);
    } catch (error) {
      setNote({ text: errorText(error), error: true });
      return false;
    }
    setInstalled(true);
    setNote({ text: acceptedMessage(result.tool) });
    onInstalled?.();
    return true;
  }, [onAccept, onInstalled, projectDir, verify]);

  const chooseParent = useCallback(async () => {
    if (!project) return;
    const path = await project.projects.pickDirectory();
    if (path) setParent(path);
  }, [project]);

  return {
    wish, setWish, parent, chooseParent, resetParent: () => setParent(null),
    projectDir, check, note, busy, start, verify, installed, install,
  };
}
