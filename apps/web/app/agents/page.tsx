export default function AgentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Agents</h1>
        <p className="text-sm text-muted">Describe a job in plain English, connect tools, deploy on a schedule.</p>
      </div>
      <div className="card">
        <div className="card-title">Coming next</div>
        <p className="mt-2 text-sm text-muted">
          The agent builder + scheduler lands in the next phase. The database, the run history,
          and the approval gate that protects every send/post/spend are already in place — so when
          agents start running, their work shows up under “What Jarvis did yesterday,” and anything
          risky waits for you on the Approvals screen.
        </p>
        <ul className="mt-3 space-y-1 text-sm text-muted">
          <li>• Describe the job → Jarvis compiles it into a runnable agent.</li>
          <li>• Pick which connected tools / MCP servers it may use.</li>
          <li>• Deploy it to run on a schedule on the Railway worker.</li>
          <li>• Approve anything important before it sends or spends.</li>
        </ul>
      </div>
    </div>
  );
}
