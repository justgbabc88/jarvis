import Link from "next/link";
import { supabaseConfigured } from "@/lib/supabase";
import {
  getBusinessCards,
  getYesterdayActivity,
  getPendingApprovals,
  getActiveGoals,
} from "@/lib/data";
import { getTodayAgenda } from "@/lib/agenda";
import { relativeDay } from "@/lib/format";
import VoiceBriefing from "@/components/VoiceBriefing";
import { getAssistantIdentity } from "@/lib/identity";
import TrackersCard from "@/components/TrackersCard";
import BusinessCardView from "@/components/BusinessCardView";
import SyncButton from "@/components/SyncButton";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  if (!supabaseConfigured()) {
    return (
      <div className="card">
        <h1 className="text-xl font-semibold">Finish setup</h1>
        <p className="mt-2 text-muted">
          Set <code className="text-accent2">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code className="text-accent2">SUPABASE_SERVICE_ROLE_KEY</code> (plus{" "}
          <code className="text-accent2">ANTHROPIC_API_KEY</code>), run the migration in{" "}
          <code>supabase/migrations</code>, then reload. See the README.
        </p>
      </div>
    );
  }

  const [cards, activity, approvals, goals, agenda] = await Promise.all([
    getBusinessCards(),
    getYesterdayActivity(),
    getPendingApprovals(),
    getActiveGoals(),
    getTodayAgenda(),
  ]);

  return (
    <div className="space-y-6">
      <VoiceBriefing assistantName={(await getAssistantIdentity()).name} />

      {approvals.length > 0 && (
        <Link
          href="/approvals"
          className="card flex items-center justify-between border-warn/40 bg-warn/5 hover:bg-warn/10"
        >
          <div>
            <div className="font-medium text-warn">
              {approvals.length} action{approvals.length === 1 ? "" : "s"} waiting for your approval
            </div>
            <div className="text-xs text-muted">
              Nothing that sends, posts, deletes, or spends goes out until you say so.
            </div>
          </div>
          <span className="btn">Review →</span>
        </Link>
      )}

      {/* Businesses */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent/70">
          // business units
        </span>
        <span className="holo-rule" />
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted">
          {cards.length} online
        </span>
        <SyncButton />
      </div>

      {cards.length === 0 ? (
        <div className="card">
          <h2 className="font-semibold">No businesses yet</h2>
          <p className="mt-1 text-muted">
            Businesses are a setting, not code. Add Londen Leads, Quantum Sync, or anything else —
            and remove them anytime.
          </p>
          <Link href="/settings" className="btn btn-primary mt-3">
            Add a business
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {cards.map((b) => (
            <BusinessCardView key={b.id} b={b} />
          ))}
        </div>
      )}

      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-accent/70">
          // systems
        </span>
        <span className="holo-rule" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* What Jarvis did yesterday */}
        <div className="card">
          <div className="card-title mb-3">What Jarvis did yesterday</div>
          {activity.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing logged yet. Once your agents run, their work shows up here.
            </p>
          ) : (
            <ul className="space-y-3">
              {activity.map((a) => (
                <li key={a.id} className="flex items-start gap-3">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent2" />
                  <div>
                    <div className="text-sm">{a.summary}</div>
                    <div className="text-xs text-muted">
                      {a.type} · {relativeDay(a.created_at)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Tasks & calendar (today) */}
        <div className="card">
          <div className="card-title mb-3">Today · tasks &amp; calendar</div>
          {!agenda.connected.calendar && !agenda.connected.clickup ? (
            <>
              <p className="text-sm text-muted">
                Connect a calendar and task tool to see what’s on your plate today.
              </p>
              <Link href="/connections" className="btn mt-3">
                Connect calendar / tasks
              </Link>
            </>
          ) : (
            <div className="space-y-4">
              {agenda.connected.calendar && (
                <div>
                  <div className="text-xs font-medium uppercase text-muted">Calendar</div>
                  {agenda.events.length === 0 ? (
                    <p className="mt-1 text-sm text-muted">Nothing on the calendar today.</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {agenda.events.slice(0, 8).map((e, i) => (
                        <li key={i} className="flex items-baseline gap-2 text-sm">
                          <span className="w-14 shrink-0 text-xs text-accent2">{e.time}</span>
                          <span>{e.summary}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {agenda.connected.clickup && (
                <div>
                  <div className="text-xs font-medium uppercase text-muted">Tasks due</div>
                  {agenda.tasks.length === 0 ? (
                    <p className="mt-1 text-sm text-muted">Nothing due today. Clear plate.</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {agenda.tasks.slice(0, 8).map((t) => (
                        <li key={t.id} className="flex items-baseline gap-2 text-sm">
                          <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent2" />
                          <a href={t.url} target="_blank" rel="noreferrer" className="hover:underline">
                            {t.name}
                          </a>
                          {t.overdue && <span className="pill text-bad">overdue</span>}
                          {t.listName && <span className="text-xs text-muted">{t.listName}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {agenda.errors.length > 0 && (
                <p className="text-xs text-bad">{agenda.errors.join(" · ")}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <TrackersCard />

      {/* Goals teaser */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="card-title">Goals</div>
          <Link href="/goals" className="text-xs text-accent2 hover:underline">
            Open goals →
          </Link>
        </div>
        {goals.length === 0 ? (
          <p className="mt-2 text-sm text-muted">
            Set a goal and Jarvis will suggest revenue-generating moves and research to get you there.
          </p>
        ) : (
          <ul className="mt-2 space-y-1">
            {goals.slice(0, 3).map((g: any) => (
              <li key={g.id} className="text-sm">
                • {g.title}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
