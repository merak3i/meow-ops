import SessionTable from '../components/SessionTable';

export default function Sessions({ sessions }) {
  return (
    <div>
      <h2 style={{ fontSize: 22, marginBottom: 24 }}>Sessions</h2>
      <SessionTable sessions={sessions} />
    </div>
  );
}
