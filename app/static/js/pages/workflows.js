import { renderWorkflowsTab } from '../components/settings/workflows.js';

export async function renderWorkflows(container) {
  container.innerHTML = '<div class="text-muted p-3">Loading...</div>';
  await renderWorkflowsTab(container);
}
