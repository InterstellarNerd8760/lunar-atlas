// Outcome and coordinate precision are independent attributes.
export function pinStatus(place) {
  if (place.failed || place.kind === 'failed landing') return 'failed';
  // Future regions are still future regions even when their proxy coordinates are approximate.
  if (place.group === 'artemis' || place.proxy) return 'future';
  if (place.approximate) return 'approximate';
  if (place.group === 'feature' || place.group === 'point') return 'feature';
  return 'landed';
}
export function pinDescription(place) {
  const status = pinStatus(place);
  if (status === 'failed') return place.approximate ? 'Failed landing, approximate impact' : 'Failed landing attempt';
  if (status === 'approximate') return 'Approximate landing location';
  if (status === 'future') return 'Candidate landing region (terrain proxy)';
  if (status === 'feature') return 'Lunar terrain feature';
  return 'Landing site';
}
