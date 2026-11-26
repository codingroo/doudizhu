"""Let DouZero models play against each other (no web page, no score file is touched).

Usage (from this folder):
    python arena.py wp=pretrained\\douzero_WP adp=pretrained\\douzero_ADP sl=pretrained\\douzero_SL --games 200

Every name=folder pair is a model (the folder holds landlord.onnx, landlord_up.onnx, landlord_down.onnx).
Every pair of models plays against each other. For each deal the same cards are played twice, once with model A as
the landlord (B plays both peasants) and once with B as the landlord (A plays both peasants), so luck of the deal
cancels out. The landlord is fixed (no bidding) and the base score is 1; each bomb / rocket / spring / anti-spring
doubles the score, as in the game.

Options:
    --games N         number of deals per pair (every deal is played twice), default 200
    --seed S          random seed, default 1 (same seed = same deals, so runs are comparable)
"""
import itertools
import math
import os
import random
import sys
import time

import numpy as np

from utils.move_generator import MovesGener
from utils import move_detector as md, move_selector as ms
from deep import DeepAgent

POSITIONS = ['landlord', 'landlord_down', 'landlord_up']  # index 0, 1, 2; the turn order is 0 -> 1 -> 2 -> 0 ...
FULL_DECK = [c for c in range(3, 15) for _ in range(4)] + [17] * 4 + [20, 30]


class InfoSet(object):
    pass


def get_legal_actions(player_hand_cards, rival_move):
    # same as _get_legal_card_play_actions() in run_douzero.py (copied so that the web server is not started here)
    mg = MovesGener(player_hand_cards)
    rival_type = md.get_move_type(rival_move)
    t = rival_type['type']
    n = rival_type.get('len', 1)
    moves = []
    if t == md.TYPE_0_PASS:
        moves = mg.gen_moves()
    elif t == md.TYPE_1_SINGLE:
        moves = ms.filter_type_1_single(mg.gen_type_1_single(), rival_move)
    elif t == md.TYPE_2_PAIR:
        moves = ms.filter_type_2_pair(mg.gen_type_2_pair(), rival_move)
    elif t == md.TYPE_3_TRIPLE:
        moves = ms.filter_type_3_triple(mg.gen_type_3_triple(), rival_move)
    elif t == md.TYPE_4_BOMB:
        moves = ms.filter_type_4_bomb(mg.gen_type_4_bomb() + mg.gen_type_5_king_bomb(), rival_move)
    elif t == md.TYPE_5_KING_BOMB:
        moves = []
    elif t == md.TYPE_6_3_1:
        moves = ms.filter_type_6_3_1(mg.gen_type_6_3_1(), rival_move)
    elif t == md.TYPE_7_3_2:
        moves = ms.filter_type_7_3_2(mg.gen_type_7_3_2(), rival_move)
    elif t == md.TYPE_8_SERIAL_SINGLE:
        moves = ms.filter_type_8_serial_single(mg.gen_type_8_serial_single(repeat_num=n), rival_move)
    elif t == md.TYPE_9_SERIAL_PAIR:
        moves = ms.filter_type_9_serial_pair(mg.gen_type_9_serial_pair(repeat_num=n), rival_move)
    elif t == md.TYPE_10_SERIAL_TRIPLE:
        moves = ms.filter_type_10_serial_triple(mg.gen_type_10_serial_triple(repeat_num=n), rival_move)
    elif t == md.TYPE_11_SERIAL_3_1:
        moves = ms.filter_type_11_serial_3_1(mg.gen_type_11_serial_3_1(repeat_num=n), rival_move)
    elif t == md.TYPE_12_SERIAL_3_2:
        moves = ms.filter_type_12_serial_3_2(mg.gen_type_12_serial_3_2(repeat_num=n), rival_move)
    elif t == md.TYPE_13_4_2:
        moves = ms.filter_type_13_4_2(mg.gen_type_13_4_2(), rival_move)
    elif t == md.TYPE_14_4_22:
        moves = ms.filter_type_14_4_22(mg.gen_type_14_4_22(), rival_move)
    if t not in [md.TYPE_0_PASS, md.TYPE_4_BOMB, md.TYPE_5_KING_BOMB]:
        moves = moves + mg.gen_type_4_bomb() + mg.gen_type_5_king_bomb()
    if len(rival_move) != 0:
        moves = moves + [[]]
    for m in moves:
        m.sort()
    moves.sort()
    return list(move for move, _ in itertools.groupby(moves))


def play_game(hands, agents):
    """hands: 3 lists (landlord has 20 cards). agents: 3 DeepAgent, one per position.
    Returns (landlord_won, bombs, spring, anti_spring)."""
    hands = [sorted(h) for h in hands]
    seq, last_moves, played = [], [[], [], []], [[], [], []]
    plays = [0, 0, 0]
    bombs = 0
    pos = 0
    for _ in range(1000):
        rival = []
        if seq:
            rival = seq[-2] if len(seq[-1]) == 0 and len(seq) >= 2 else seq[-1]
        info = InfoSet()
        info.player_position = pos
        info.player_hand_cards = hands[pos]
        info.num_cards_left = [len(h) for h in hands]
        info.three_landlord_cards = []
        info.card_play_action_seq = seq
        info.other_hand_cards = sorted(c for i in range(3) if i != pos for c in hands[i])
        info.rival_move = rival
        info.legal_actions = get_legal_actions(hands[pos], rival)
        info.last_moves = last_moves
        info.played_cards = played
        info.bomb_num = bombs
        actions, conf = agents[pos].act(info)
        action = list(actions[int(np.argmax(conf))])   # the game also takes the action with the best score
        if action:
            for c in action:
                hands[pos].remove(c)
            played[pos] = played[pos] + action
            plays[pos] += 1
            if md.get_move_type(action)['type'] in (md.TYPE_4_BOMB, md.TYPE_5_KING_BOMB):
                bombs += 1
        seq.append(action)
        last_moves[pos] = action
        if not hands[pos]:
            landlord_won = pos == 0
            spring = landlord_won and plays[1] == 0 and plays[2] == 0
            anti = (not landlord_won) and plays[0] == 1
            return landlord_won, bombs, spring, anti
        pos = (pos + 1) % 3
    raise RuntimeError('game did not finish')


def landlord_points(landlord_won, bombs, spring, anti):
    mult = 2 ** (bombs + int(spring) + int(anti))
    return 2 * mult if landlord_won else -2 * mult


def main(argv):
    games, seed = 200, 1
    models, i = {}, 0
    while i < len(argv):
        a = argv[i]
        if a == '--games':
            games = int(argv[i + 1]); i += 2
        elif a == '--seed':
            seed = int(argv[i + 1]); i += 2
        elif '=' in a:
            name, folder = a.split('=', 1)
            models[name] = folder; i += 1
        else:
            sys.exit(__doc__)
    if len(models) < 2:
        sys.exit(__doc__)
    print('deals per pair:', games, '| seed:', seed)

    agents = {}
    for name, folder in models.items():
        for p in POSITIONS:
            if not os.path.isfile(os.path.join(folder, p + '.onnx')):
                sys.exit('Not found: ' + os.path.join(folder, p + '.onnx'))
        agents[name] = [DeepAgent(p, folder, use_onnx=True) for p in POSITIONS]

    for a, b in itertools.combinations(models, 2):
        rng = random.Random(seed)
        stats = dict(a_land_wins=0, a_peas_wins=0, bombs=0, diffs=[])
        t0 = time.time()
        for d in range(games):
            deck = FULL_DECK[:]
            rng.shuffle(deck)
            hands = [deck[0:17] + deck[51:54], deck[17:34], deck[34:51]]
            # game 1: a is the landlord, b plays both peasants
            r1 = play_game(hands, [agents[a][0], agents[b][1], agents[b][2]])
            # game 2: same deal, b is the landlord, a plays both peasants
            r2 = play_game(hands, [agents[b][0], agents[a][1], agents[a][2]])
            s1, s2 = landlord_points(*r1), landlord_points(*r2)
            stats['a_land_wins'] += int(r1[0])
            stats['a_peas_wins'] += int(not r2[0])
            stats['bombs'] += r1[1] + r2[1]
            stats['diffs'].append(s1 - s2)  # points won by a in this deal (landlord-points: +-2 x multiplier)
            if (d + 1) % 20 == 0 or d + 1 == games:
                el = time.time() - t0
                print('  %s vs %s: %d/%d deals, %.0f s elapsed, about %.0f s left' % (a, b, d + 1, games, el, el / (d + 1) * (games - d - 1)), flush=True)
        n = games
        diffs = np.array(stats['diffs'], dtype=float)
        mean = diffs.mean() / 2          # per game (every deal is two games)
        se = diffs.std(ddof=1) / math.sqrt(n) / 2 if n > 1 else float('nan')
        print('\n=== %s vs %s (%d deals = %d games) ===' % (a, b, n, 2 * n))
        print('  %s wins as landlord : %5.1f %%   (%s as landlord wins %5.1f %%)' % (a, 100.0 * stats['a_land_wins'] / n, b, 100.0 - 100.0 * stats['a_peas_wins'] / n))
        print('  %s wins as peasants : %5.1f %%   (%s as peasants wins %5.1f %%)' % (a, 100.0 * stats['a_peas_wins'] / n, b, 100.0 - 100.0 * stats['a_land_wins'] / n))
        print('  overall win rate of %s : %5.1f %%' % (a, 100.0 * (stats['a_land_wins'] + stats['a_peas_wins']) / (2 * n)))
        print('  average points of %s per game, relative to %s: %+.3f  (+-%.3f, 95%% range %+.3f .. %+.3f)' % (a, b, mean, 1.96 * se, mean - 1.96 * se, mean + 1.96 * se))
        print('  bombs per game: %.2f' % (stats['bombs'] / (2 * n)))
        if se == se and abs(mean) > 1.96 * se:
            print('  -> the difference is probably real: %s is %s' % (a, 'stronger' if mean > 0 else 'weaker'))
        else:
            print('  -> the difference is within the noise: more deals are needed to tell them apart')
        print()


if __name__ == '__main__':
    main(sys.argv[1:])
