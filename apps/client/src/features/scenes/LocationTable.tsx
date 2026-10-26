import { CombatPanel } from "../combat/CombatPanel";
import { useEffect, useState, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientEvents,
  ServerEvents,
  CombatSnapshot,
  LocationSnapshot,
  RoomMember,
  LocationPing,
} from "@dnd/shared";
import { LocationManager } from "./LocationManager";
import { InteractiveMap } from "./InteractiveMap";
import { TokenManager } from "./TokenManager";
import { api, errorMessage } from "../../lib/api";
import { WorkspaceArea, useWorkspace } from "../workspace/Workspace";

export function LocationTable({
  campaignId,
  role,
}: {
  campaignId: string;
  role: "DM" | "PLAYER";
}) {
  const workspace = useWorkspace(),
    updateWorkspace = workspace?.update;
  const [combat, setCombat] = useState<CombatSnapshot | null>(null);
  function acceptCombat(snapshot: CombatSnapshot) {
    setCombat((previous) =>
      !previous ||
      (snapshot.version >= previous.version &&
        snapshot.locationVersion >= previous.locationVersion)
        ? snapshot
        : previous,
    );
  }
  const [state, setState] = useState<LocationSnapshot | null>(null);
  const [status, setStatus] = useState("Підключення…");
  const [online, setOnline] = useState<RoomMember[]>([]);
  const [revision, setRevision] = useState(0);
  const [retry, setRetry] = useState(0);

  const [tableError, setTableError] = useState("");
  const [pulse, setPulse] = useState<LocationPing | null>(null);
  const connection = useRef<Socket<ServerEvents, ClientEvents> | null>(null);
  useEffect(() => {
    if (!pulse) return;
    const timer = setTimeout(() => setPulse(null), 3000);
    return () => clearTimeout(timer);
  }, [pulse]);
  useEffect(() => setPulse(null), [state?.scene?.id]);
  useEffect(() => {
    const socket: Socket<ServerEvents, ClientEvents> = io({
      auth: { campaignId },
      autoConnect: false,
    });
    connection.current = socket;
    setCombat(null);
    setState(null);
    setOnline([]);
    setStatus("Підключення…");
    socket.on("location:snapshot", (snapshot) => {
      setState((previous) =>
        !previous || snapshot.version >= previous.version ? snapshot : previous,
      );
      setStatus("Онлайн");
    });
    socket.on("combat:snapshot", acceptCombat);
    socket.on("room:snapshot", (snapshot) => setOnline(snapshot.members));
    socket.on("location:ping", setPulse);
    socket.on("locations:changed", () => setRevision((value) => value + 1));
    socket.on("disconnect", () => {
      setCombat(null);
      setState(null);
      setStatus("З’єднання втрачено. Перепідключення…");
    });
    socket.on("connect_error", (error) => {
      setCombat(null);
      setState(null);
      setStatus(error.message);
    });
    socket.on("room:error", setStatus);
    socket.connect();
    return () => {
      connection.current = null;
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [campaignId, retry]);
  useEffect(() => {
    updateWorkspace?.({
      scene: state
        ? (state.scene?.name ?? "Порожній стіл")
        : "Відновлюємо локацію…",
      sync: status,
      members: online.filter((m) => m.online).length,
    });
  }, [state?.scene?.name, status, online, updateWorkspace]);
  return (
    <section aria-label="Ігровий стіл" className="table-controller">
      <WorkspaceArea name="campaign.context">
        <h3>За столом</h3>
        <p role="status">
          {status}{" "}
          <button onClick={() => setRetry((value) => value + 1)}>
            Перепідключитися
          </button>
        </p>
        <ul className="member-list">
          {online.map((member) => (
            <li key={member.userId}>
              <span
                className={`connection-dot ${member.online ? "connected" : ""}`}
              />
              <strong>{member.displayName}</strong>
              <small>
                {member.role === "DM" ? "DM" : "Гравець"} ·{" "}
                {member.online ? "онлайн" : "офлайн"}
              </small>
            </li>
          ))}
        </ul>
      </WorkspaceArea>
      <WorkspaceArea name="combat.main">
        <CombatPanel
          campaignId={campaignId}
          dm={role === "DM"}
          scene={state?.scene ?? null}
          snapshot={combat}
          ready={Boolean(connection.current?.connected) && Boolean(combat)}
          onSnapshot={acceptCombat}
          onSync={() => {
            connection.current?.timeout(10000).emit("room:sync", () => {});
          }}
        />
      </WorkspaceArea>
      <WorkspaceArea name="combat.context">
        <div className="info-card">
          <h4>Ведіть історію, а не таблицю</h4>
          <p>
            Порядок за ініціативою. За однакових значень першим ходить той, кого
            додали раніше. Прихованих учасників гравці не бачать.
          </p>
          <p>
            Next — наступний хід. Previous — попередній. Skip пропускає поточний
            хід.
          </p>
        </div>
      </WorkspaceArea>
      <WorkspaceArea name="table.context">
        <div className="scene-summary">
          <span className="eyebrow">АКТИВНА ЛОКАЦІЯ</span>
          <h3>{state?.scene?.name ?? "Стіл порожній"}</h3>
          <p>
            {state?.scene?.description ??
              "Оберіть підготовлену локацію в Scenes."}
          </p>
          {workspace && role === "DM" && (
            <button onClick={() => workspace.navigate("scenes")}>
              Керувати локаціями →
            </button>
          )}
        </div>
        {role === "PLAYER" && combat?.encounter && (
          <div className="compact-initiative">
            <h4>Раунд {combat.encounter.round}</h4>
            {combat.encounter.participants.map((p) => (
              <p
                key={p.id}
                aria-current={
                  p.id === combat.encounter?.currentParticipantId
                    ? "step"
                    : undefined
                }
              >
                {p.id === combat.encounter?.currentParticipantId ? "→ " : ""}
                {p.name}
                <small>{p.initiative}</small>
              </p>
            ))}
          </div>
        )}
      </WorkspaceArea>
      <WorkspaceArea name="table.main">
        <div
          className="table-stage"
          inert={
            role === "PLAYER" &&
            Boolean(workspace) &&
            workspace?.summary.mode !== "TABLE"
          }
        >
          {!state ? (
            <p>Очікуємо актуальний стан локації…</p>
          ) : !state.scene ? (
            <p>Ігровий стіл порожній. DM ще не показав локацію.</p>
          ) : (
            <article>
              <div className="table-caption">
                <span className="eyebrow">LIVE TABLE</span>
                <h3>{state.scene.name}</h3>
                <span className="live-pill">Спільна локація</span>
              </div>
              {tableError && <p role="alert">{tableError}</p>}
              <InteractiveMap
                key={`map-${state.scene.id}`}
                scene={state.scene}
                dm={role === "DM"}
                ready={Boolean(connection.current?.connected)}
                pulse={pulse}
                saveFog={async (operations) => {
                  setTableError("");
                  try {
                    await api(
                      `/campaigns/${campaignId}/locations/${state.scene!.id}/fog`,
                      { revision: state.scene!.fog.revision, operations },
                      "PATCH",
                    );
                  } catch (error) {
                    setTableError(errorMessage(error));
                    setRetry((value) => value + 1);
                  }
                }}
                move={async (token, point) => {
                  setTableError("");
                  try {
                    await api(
                      `/campaigns/${campaignId}/locations/${state.scene!.id}/tokens/${token.id}`,
                      { ...point, revision: token.revision },
                      "PATCH",
                    );
                  } catch (error) {
                    setTableError(errorMessage(error));
                  }
                }}
                ping={(point) => {
                  const socket = connection.current;
                  if (!socket?.connected) return;
                  socket
                    .timeout(10000)
                    .emit(
                      "location:ping",
                      { ...point, sceneId: state.scene!.id },
                      (error, reply) => {
                        if (error) setTableError("Пінг не підтверджено.");
                        else if (!reply.ok) setTableError(reply.message);
                      },
                    );
                }}
              />
              {role === "DM" && (
                <WorkspaceArea name="table.context">
                  <TokenManager
                    key={`tokens-${state.scene.id}`}
                    scene={state.scene}
                    campaignId={campaignId}
                  />
                </WorkspaceArea>
              )}
            </article>
          )}
        </div>
      </WorkspaceArea>
      {role === "DM" && (
        <LocationManager
          campaignId={campaignId}
          refreshKey={revision + retry}
        />
      )}
    </section>
  );
}
