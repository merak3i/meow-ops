import ProjectBreakdown from '../components/ProjectBreakdown';

export default function ByProject({ projectData }) {
  return (
    <div>
      <h2 style={{ fontSize: 22, marginBottom: 24 }}>By Project</h2>
      <ProjectBreakdown data={projectData} showTable />
    </div>
  );
}
