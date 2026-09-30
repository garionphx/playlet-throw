export const CONTROL_HINT =
  'Check the IP, and that Settings → System → Advanced system settings → Control by mobile apps is enabled.';

export function resultMessage(action, roku, result) {
  if (result.ok) {
    if (action === 'queue' && result.via === 'launch') {
      return `▶ Playlet wasn't open — playing on ${roku.name}`;
    }
    return action === 'queue' ? `➕ Queued on ${roku.name}` : `▶ Playing on ${roku.name}`;
  }
  switch (result.reason) {
    case 'rejected':
      return `Playlet on ${roku.name} rejected the request (HTTP ${result.status}).`;
    case 'launch-failed':
      return `${roku.name} refused to launch Playlet (HTTP ${result.status}). Is Playlet installed? ${CONTROL_HINT}`;
    default:
      return `Couldn't reach ${roku.name} (${roku.host}). ${CONTROL_HINT}`;
  }
}

const TEST_LABELS = {
  ok: 'Reachable — Playlet installed',
  'no-playlet': 'Reachable — Playlet not found',
  blocked: 'Reachable, but Control by mobile apps is restricted',
  unreachable: 'Unreachable',
};

export function testLabel(state) {
  return TEST_LABELS[state] ?? 'Unreachable';
}
