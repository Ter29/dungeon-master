import { useEffect, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import type { ClientEvents, ServerEvents, DirectorSnapshot } from "@dnd/shared";
import { api, errorMessage } from "../../lib/api";
import { DirectorControls } from "./DirectorControls";
import { PresentationScreen } from "./PresentationScreen";
import { CampaignAudio } from "../audio/CampaignAudio";
import { WorkspaceArea, useWorkspace } from "../workspace/Workspace";
import type { AudioSnapshot, AudioCueView } from "@dnd/shared";
export function CinematicDirector({
  campaignId,
  dm,
  children,
  onTable,
}: {
  campaignId: string;
  dm: boolean;
  children: ReactNode;
  onTable: () => void;
}) {
  const workspace = useWorkspace(),
    updateWorkspace = workspace?.update;
  const [state, setState] = useState<DirectorSnapshot | null>(null),
    [online, setOnline] = useState(false),
    [status, setStatus] = useState("Підключення подачі…"),
    [libraryKey, setLibraryKey] = useState(0),
    [retry, setRetry] = useState(0);
  const [audio, setAudio] = useState<AudioSnapshot | null>(null),
    [cues, setCues] = useState<AudioCueView[]>([]),
    [audioLibraryKey, setAudioLibraryKey] = useState(0);
  const socketRef = useRef<Socket<ServerEvents, ClientEvents> | null>(null);
  function accept(value: DirectorSnapshot) {
    setState((previous) =>
      !previous || value.version >= previous.version ? value : previous,
    );
  }
  async function refresh() {
    try {
      accept(
        await api<DirectorSnapshot>(`/campaigns/${campaignId}/director/state`),
      );
    } catch (e) {
      setStatus(errorMessage(e));
    }
  }
  useEffect(() => {
    setState(null);
    setOnline(false);
    const socket: Socket<ServerEvents, ClientEvents> = io({
      auth: { campaignId },
      autoConnect: false,
    });
    socketRef.current = socket;
    setAudio(null);
    setCues([]);
    socket.on("audio:snapshot", (value) =>
      setAudio((previous) =>
        !previous || value.version >= previous.version ? value : previous,
      ),
    );
    socket.on("audio:cue", (cue) => setCues((old) => [...old.slice(-31), cue]));
    socket.on("audio:library-changed", () => setAudioLibraryKey((n) => n + 1));
    socket.on("disconnect", () => {
      setAudio(null);
      setCues([]);
    });
    socket.on("connect_error", () => setAudio(null));
    socket.on("director:snapshot", (value) => {
      accept(value);
      setOnline(true);
      setStatus("Подача онлайн");
    });
    socket.on("director:library-changed", () => setLibraryKey((n) => n + 1));
    socket.on("disconnect", () => {
      setState(null);
      setOnline(false);
      setStatus("Відновлюємо подачу…");
    });
    socket.on("connect_error", (e) => {
      setState(null);
      setOnline(false);
      setStatus(e.message);
    });
    socket.on("room:error", setStatus);
    socket.connect();
    return () => {
      socketRef.current = null;
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [campaignId, retry]);
  const previousMode = useRef<string | null>(null);
  useEffect(() => {
    if (
      state?.mode === "TABLE" &&
      previousMode.current &&
      previousMode.current !== "TABLE"
    )
      onTable();
    if (state) previousMode.current = state.mode;
  }, [state?.mode, onTable]);
  const covered = !dm && (!state || state.mode !== "TABLE");
  useEffect(() => {
    updateWorkspace?.({ mode: state?.mode ?? "Підключення" });
  }, [state?.mode, updateWorkspace]);
  useEffect(() => {
    if (!covered) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [covered]);
  return (
    <>
      <CampaignAudio
        campaignId={campaignId}
        dm={dm}
        state={audio}
        cues={cues}
        libraryKey={audioLibraryKey}
        refresh={() => {
          socketRef.current?.emit("room:sync", () => {});
        }}
      />
      {dm && (
        <WorkspaceArea name="director.context">
          <>
            <p role="status">
              {status}{" "}
              <button onClick={() => setRetry((n) => n + 1)}>
                Перепідключити подачу
              </button>
            </p>
            <DirectorControls
              campaignId={campaignId}
              state={state}
              ready={online && Boolean(state)}
              refreshKey={libraryKey}
              onState={accept}
              refreshState={refresh}
            />
          </>
        </WorkspaceArea>
      )}
      <div data-director-workspace="true" inert={covered} aria-hidden={covered}>
        {children}
      </div>
      {!dm && (
        <WorkspaceArea name="table.main">
          <PresentationScreen
            state={state}
            fullscreen
            label="Екран презентації гравця"
          />
        </WorkspaceArea>
      )}
    </>
  );
}
