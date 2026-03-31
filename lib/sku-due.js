/** @param {string|null|undefined} lastCollected YYYY-MM-DD */
function isCollectionDue(lastCollected, collectCycle, todayUtcYmd) {
  if (lastCollected == null || lastCollected === '') return true;
  const base = lastCollected.slice(0, 10);
  const d = new Date(`${base}T12:00:00.000Z`);
  const n = Number(collectCycle);
  const days = Number.isFinite(n) ? n : 7;
  d.setUTCDate(d.getUTCDate() + days);
  const dueYmd = d.toISOString().slice(0, 10);
  return dueYmd <= todayUtcYmd;
}

function todayUtcYmd() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { isCollectionDue, todayUtcYmd };
