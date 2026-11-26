// Bidding ("叫分制") helpers for the Doudizhu PvE demo.
//
// Rules implemented:
//  - The first bidder is picked at random, then the bidding goes around the table once.
//  - Every player bids exactly once: pass (0) or 1 / 2 / 3 points.
//    A bid has to be higher than the current highest bid.
//  - A bid of 3 ends the bidding immediately.
//  - The highest bidder becomes the landlord. If all three players pass, the cards are redealt.
//
// Everything in this file is pure (no React, no DOM), so it is easy to test on its own.
// Cards use the same strings as the rest of the app: 'RJ' (big joker), 'BJ' (small joker)
// and suit + rank for the others, e.g. 'S2', 'HT' (ten), 'DA'.

export const BID_OPTIONS = [0, 1, 2, 3];

// Seat index of the landlord -> role name understood by handleSelectRole() in PvEDoudizhuDemoView.
// Seat 0 is the human player; the turn order is 0 -> 1 -> 2 -> 0.
export const landlordIdxToRole = ['landlord', 'landlord_up', 'landlord_down'];

// ---------------------------------------------------------------------------
// AI bidding: a simple hand-strength rule. Tune these numbers to make the AI
// bolder (lower the thresholds) or more careful (raise them).
// ---------------------------------------------------------------------------
export const HAND_SCORES = {
    rocket: 8, // both jokers (replaces the two joker scores below)
    bigJoker: 4,
    smallJoker: 3,
    bomb: 6, // four of a kind
    two: 2, // each single '2' that is not part of a bomb
};

// With random deals roughly 14% of hands reach 10, 32% reach 7 and 71% reach 4.
export const BID_THRESHOLDS = {
    three: 10, // strength >= 10 -> wants to bid 3
    two: 7, // strength >= 7 -> wants to bid 2
    one: 4, // strength >= 4 -> wants to bid 1
};

export function evaluateHand(hand) {
    let bigJoker = false;
    let smallJoker = false;
    const counts = {};
    hand.forEach((card) => {
        if (card === 'RJ') bigJoker = true;
        else if (card === 'BJ') smallJoker = true;
        else counts[card[1]] = (counts[card[1]] || 0) + 1;
    });

    let score = 0;
    if (bigJoker && smallJoker) score += HAND_SCORES.rocket;
    else if (bigJoker) score += HAND_SCORES.bigJoker;
    else if (smallJoker) score += HAND_SCORES.smallJoker;

    Object.keys(counts).forEach((rank) => {
        if (counts[rank] === 4) score += HAND_SCORES.bomb;
        else if (rank === '2') score += HAND_SCORES.two * counts[rank];
    });
    return score;
}

export function strengthToBid(strength) {
    if (strength >= BID_THRESHOLDS.three) return 3;
    if (strength >= BID_THRESHOLDS.two) return 2;
    if (strength >= BID_THRESHOLDS.one) return 1;
    return 0;
}

// The bid the AI makes with `hand` when the highest bid so far is `highest`.
export function aiBid(hand, highest) {
    const wanted = strengthToBid(evaluateHand(hand));
    return wanted > highest ? wanted : 0;
}

// ---------------------------------------------------------------------------
// Bidding state machine
// ---------------------------------------------------------------------------
export function createBidState(firstBidder) {
    return {
        current: firstBidder, // seat that has to bid now (null when nobody has to)
        bids: [null, null, null], // null = has not bid yet, 0 = passed, 1-3 = points
        highest: 0,
        highestBidder: -1,
        count: 0, // number of bids made
        finished: false,
    };
}

export function legalBids(state) {
    return BID_OPTIONS.filter((bid) => bid === 0 || bid > state.highest);
}

// Returns the new state. Illegal bids (wrong player, too low, bidding already over) are ignored.
export function applyBid(state, player, bid) {
    if (state.finished || state.current !== player || legalBids(state).indexOf(bid) < 0) return state;

    const bids = state.bids.slice();
    bids[player] = bid;
    const raised = bid > state.highest;
    const count = state.count + 1;
    const finished = bid === 3 || count === 3;
    return {
        current: finished ? null : (player + 1) % 3,
        bids,
        highest: raised ? bid : state.highest,
        highestBidder: raised ? player : state.highestBidder,
        count,
        finished,
    };
}
