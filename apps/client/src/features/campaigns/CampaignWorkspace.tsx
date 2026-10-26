import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { api, errorMessage } from "../../lib/api";
import type { Campaign } from "./CampaignsPage";
import {
  CommandCenter,
  WorkspaceArea,
  useWorkspace,
} from "../workspace/Workspace";
import { CinematicDirector } from "../director/CinematicDirector";
import { LocationTable } from "../scenes/LocationTable";
import { Cartography } from "../cartography/Cartography";
import { Room } from "../room/Room";
type Details = Campaign & {
  members: { userId: string; displayName: string; role: string }[];
};
type Invite = { id: string; expiresAt: string; revokedAt: string | null };
export function CampaignPage() {
  const { id } = useParams();
  const [diagnostics, setDiagnostics] = useState(false);
  const [campaign, setCampaign] = useState<Details | null>(null),
    [invites, setInvites] = useState<Invite[]>([]),
    [link, setLink] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  async function load(initial = false) {
    if (initial) setLoading(true);
    setError("");
    try {
      const { campaign } = await api<{ campaign: Details }>(`/campaigns/${id}`);
      setCampaign(campaign);
      if (campaign.role === "DM")
        setInvites(
          (await api<{ invites: Invite[] }>(`/campaigns/${id}/invites`))
            .invites,
        );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setLink("");
    void load(true);
  }, [id]);
  async function createInvite() {
    setBusy(true);
    setError("");
    try {
      const { invite } = await api<{ invite: { url: string } }>(
        `/campaigns/${id}/invites`,
        {},
      );
      setLink(invite.url);
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(inviteId: string) {
    if (
      !window.confirm(
        "Відкликати запрошення? Нові гравці не зможуть використати це посилання.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await api(`/campaigns/${id}/invites/${inviteId}/revoke`, {});
      setLink("");
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="page-loading" role="status">
        <span className="loading-orbit" />
        Готуємо ваш ігровий стіл…
      </div>
    );
  if (!campaign)
    return (
      <div className="empty-card">
        <h2>Не вдалося відкрити кампанію</h2>
        <p role="alert">{error || "Перевірте запрошення та права доступу."}</p>
        <button onClick={() => void load(true)}>Спробувати знову</button>
        <Link to="/campaigns">Повернутися до кампаній</Link>
      </div>
    );
  return (
    <CommandCenter
      key={campaign.id}
      campaignId={campaign.id}
      name={campaign.name}
      dm={campaign.role === "DM"}
    >
      <CampaignContent campaign={campaign} />
      <WorkspaceArea name="campaign.main">
        <div className="section-intro">
          <span className="eyebrow">YOUR NEXT GREAT STORY</span>
          <h3>{campaign.name}</h3>
          <p>
            {campaign.role === "DM"
              ? "Ваш світ. Ваша група. Ваша наступна пригода."
              : "Ваша спільна історія починається за цим столом."}
          </p>
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="info-card">
          <h3>Доступ до кампанії</h3>
          <p>
            Ваша роль:{" "}
            <strong>
              {campaign.role === "DM" ? "Dungeon Master" : "Player"}
            </strong>
          </p>
          <button disabled={busy} onClick={() => void load()}>
            Оновити дані кампанії
          </button>
        </div>
        {campaign.role === "DM" && (
          <section className="campaign-invites">
            <h3>Запросіть свою групу</h3>
            <p>Особисті облікові записи. Одне посилання — спільна пригода.</p>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void createInvite()}
            >
              Створити запрошення на 7 днів
            </button>
            {link && (
              <div className="success-card" role="status">
                <label>
                  Посилання запрошення
                  <input
                    aria-label="Посилання запрошення"
                    readOnly
                    value={link}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                </label>
                <p>
                  Скопіюйте зараз — після виходу посилання не відображатиметься.
                </p>
                <button
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(link)
                      .catch(() =>
                        setError("Скопіюйте посилання з поля вручну."),
                      )
                  }
                >
                  Скопіювати посилання
                </button>
              </div>
            )}
            <ul>
              {invites.map((i) => (
                <li key={i.id}>
                  До {new Date(i.expiresAt).toLocaleString("uk-UA")}{" "}
                  <span className="muted">
                    {i.revokedAt
                      ? "Відкликано"
                      : new Date(i.expiresAt) <= new Date()
                        ? "Завершилося"
                        : "Активне"}
                  </span>
                  {!i.revokedAt && new Date(i.expiresAt) > new Date() && (
                    <button disabled={busy} onClick={() => void revoke(i.id)}>
                      Відкликати
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {campaign.role === "DM" && (
          <details
            className="legacy-table"
            onToggle={(e) => setDiagnostics(e.currentTarget.open)}
          >
            <summary>Діагностика · тестовий стіл Sprint 1</summary>
            {diagnostics && (
              <Room campaignId={campaign.id} role={campaign.role} />
            )}
          </details>
        )}
      </WorkspaceArea>
    </CommandCenter>
  );
}
function CampaignContent({ campaign }: { campaign: Details }) {
  const workspace = useWorkspace()!;
  const [mapsVisited, setMapsVisited] = useState(workspace.section === "maps");
  useEffect(() => {
    if (workspace.section === "maps") setMapsVisited(true);
  }, [workspace.section]);
  return (
    <CinematicDirector
      campaignId={campaign.id}
      dm={campaign.role === "DM"}
      onTable={() => workspace.navigate("table")}
    >
      <LocationTable campaignId={campaign.id} role={campaign.role} />
      {mapsVisited && (
        <WorkspaceArea name="maps.main">
          <Cartography campaignId={campaign.id} dm={campaign.role === "DM"} />
        </WorkspaceArea>
      )}
    </CinematicDirector>
  );
}
