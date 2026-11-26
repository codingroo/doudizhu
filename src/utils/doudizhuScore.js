// Scoring for the bidding version.
//   base       = the winning bid (1, 2 or 3)
//   multiplier = 2 ^ (bombs + rockets + spring + anti-spring), no upper limit
//   landlord wins:  landlord +2 * base * multiplier, each peasant -(base * multiplier)
//   landlord loses: the opposite
// Spring:      the landlord wins and neither peasant ever played a card.
// Anti-spring: the peasants win and the landlord played only his first hand.
// A rocket counts as a bomb (the caller counts both as "bombs").

export function isSpring(landlordWon, landlordIdx, playCounts) {
    if (!landlordWon) return false;
    return [0, 1, 2].filter((i) => i !== landlordIdx).every((i) => playCounts[i] === 0);
}

export function isAntiSpring(landlordWon, landlordIdx, playCounts) {
    return !landlordWon && playCounts[landlordIdx] === 1;
}

// playCounts[i]: number of times seat i played cards (passes are not counted)
export function settle({ base, landlordIdx, winnerIdx, bombCount, playCounts }) {
    const landlordWon = winnerIdx === landlordIdx;
    const spring = isSpring(landlordWon, landlordIdx, playCounts);
    const antiSpring = isAntiSpring(landlordWon, landlordIdx, playCounts);
    const doublings = bombCount + (spring ? 1 : 0) + (antiSpring ? 1 : 0);
    const multiplier = Math.pow(2, doublings);
    const unit = base * multiplier;
    const sign = landlordWon ? 1 : -1;
    const deltas = [0, 1, 2].map((i) => (i === landlordIdx ? sign * 2 * unit : -sign * unit));
    return { base, multiplier, bombCount, spring, antiSpring, landlordWon, landlordIdx, deltas };
}

// multiplier of the running game (spring is only known at the end)
export function currentMultiplier(bombCount) {
    return Math.pow(2, bombCount);
}
