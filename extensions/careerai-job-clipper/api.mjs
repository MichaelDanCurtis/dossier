export const careeraiOrigin = 'https://careerai.thecurtis.cloud';
export async function careeraiRequest(path, body, token, signal) {
  if (!['/api/extension/pair', '/api/extension/jobs', '/api/extension/revoke'].includes(path)) throw new Error('This extension can only pair and save jobs.');
  const response = await fetch(careeraiOrigin + path, { method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000), headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  let result; try { result = await response.json(); } catch { throw new Error('CareerAI returned an unexpected response. Check your saved jobs before retrying.'); }
  if (!response.ok) throw Object.assign(new Error(result.error || 'CareerAI could not complete this request.'), { status: response.status });
  return result;
}
