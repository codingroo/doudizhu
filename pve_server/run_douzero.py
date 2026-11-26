import itertools
import os

from flask import Flask, jsonify, redirect, request, send_from_directory
from flask_cors import CORS
from werkzeug.utils import safe_join

# static_folder=None: Flask's built-in /static route would shadow the /static/ folder of the web page
app = Flask(__name__, static_folder=None)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# the built web page (the output of `npm run build`); when it is present this server also serves the page
WEB_DIR = os.path.join(BASE_DIR, 'web')
GAME_PAGE = '/doudizhu'

# ---- settings you may edit -------------------------------------------------
# The name of the owner, who plays on this computer directly (visitors choose their own nickname in the page).
PLAYER_ID = 'Max'
# Names of the two AI players: [right-hand player, left-hand player]
AI_NAMES = ['AI 赌圣', 'AI 赌神']
# Where the data is kept (see score_store.py): the scores per player (used by the game page, do not edit),
# the player records and the log of what happened (for you to read). Delete score.json to reset all scores.
SCORE_FILE = os.path.join(BASE_DIR, 'score.json')
PLAYERS_FILE = os.path.join(BASE_DIR, 'players.json')
LOG_FILE = os.path.join(BASE_DIR, 'play.log')
# ----------------------------------------------------------------------------

from utils.move_generator import MovesGener
from utils import move_detector as md, move_selector as ms
from deep import DeepAgent
import score_store

EnvCard2RealCard = {3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
                    8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q',
                    13: 'K', 14: 'A', 17: '2', 20: 'X', 30: 'D'}

RealCard2EnvCard = {'3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
                    '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12,
                    'K': 13, 'A': 14, '2': 17, 'X': 20, 'D': 30}

pretrained_dir = os.path.join(BASE_DIR, 'pretrained', 'douzero_pretrained')
positions = ['landlord', 'landlord_down', 'landlord_up']

# fail early with a readable message when the model files are not where we expect them
missing = [p for p in positions
           if not os.path.isfile(os.path.join(pretrained_dir, p + '.onnx'))
           and not os.path.isfile(os.path.join(pretrained_dir, p + '.ckpt'))]
if missing:
    raise SystemExit(
        '\nModel files not found.\n'
        'Put these files into the folder below and start again:\n'
        '    ' + pretrained_dir + '\n'
        + ''.join('    %s.onnx\n' % p for p in missing))

players = []
for position in positions:
    players.append(DeepAgent(position, pretrained_dir, use_onnx=True))

@app.route('/predict', methods=['POST'])
def predict():
    if request.method == 'POST':
        try:
            # Player postion
            player_position = request.form.get('player_position')
            if player_position not in ['0', '1', '2']:
                return jsonify({'status': 1, 'message': 'player_position must be 0, 1, or 2'})
            player_position = int(player_position)

            # Player hand cards
            player_hand_cards = [RealCard2EnvCard[c] for c in request.form.get('player_hand_cards')]
            if player_position == 0:
                if len(player_hand_cards) < 1 or len(player_hand_cards) > 20:
                    return jsonify({'status': 2, 'message': 'the number of hand cards should be 1-20'})
            else:
                if len(player_hand_cards) < 1 or len(player_hand_cards) > 17:
                    return jsonify({'status': 3, 'message': 'the number of hand cards should be 1-17'})

            # Number cards left
            num_cards_left = [int(request.form.get('num_cards_left_landlord')), int(request.form.get('num_cards_left_landlord_down')), int(request.form.get('num_cards_left_landlord_up'))]
            if num_cards_left[player_position] != len(player_hand_cards):
                return jsonify({'status': 4, 'message': 'the number of cards left do not align with hand cards'})
            if num_cards_left[0] < 0 or num_cards_left[1] < 0 or num_cards_left[2] < 0 or num_cards_left[0] > 20 or num_cards_left[1] > 17 or num_cards_left[2] > 17:
                return jsonify({'status': 5, 'message': 'the number of cards left not in range'})

            # Three landlord cards
            three_landlord_cards = [RealCard2EnvCard[c] for c in request.form.get('three_landlord_cards')]
            if len(three_landlord_cards) < 0 or len(three_landlord_cards) > 3:
                return jsonify({'status': 6, 'message': 'the number of landlord cards should be 0-3'})

            # Card play sequence
            if request.form.get('card_play_action_seq') == '':
                card_play_action_seq = []
            else:
                card_play_action_seq = [[RealCard2EnvCard[c] for c in cards] for cards in request.form.get('card_play_action_seq').split(',')]

            # Other hand cards
            other_hand_cards = [RealCard2EnvCard[c] for c in request.form.get('other_hand_cards')]
            if len(other_hand_cards) != sum(num_cards_left) - num_cards_left[player_position]:
                return jsonify({'status': 7, 'message': 'the number of the other hand cards do not align with the number of cards left'})

            # Last moves
            last_moves = []
            for field in ['last_move_landlord', 'last_move_landlord_down', 'last_move_landlord_up']:
                last_moves.append([RealCard2EnvCard[c] for c in request.form.get(field)])

            # Played cards
            played_cards = []
            for field in ['played_cards_landlord', 'played_cards_landlord_down', 'played_cards_landlord_up']:
                played_cards.append([RealCard2EnvCard[c] for c in request.form.get(field)])

            # Bomb Num
            bomb_num = int(request.form.get('bomb_num'))

            # InfoSet
            info_set = InfoSet()
            info_set.player_position = player_position
            info_set.player_hand_cards = player_hand_cards
            info_set.num_cards_left = num_cards_left
            info_set.three_landlord_cards = three_landlord_cards
            info_set.card_play_action_seq = card_play_action_seq
            info_set.other_hand_cards = other_hand_cards
            info_set.last_moves = last_moves
            info_set.played_cards = played_cards
            info_set.bomb_num = bomb_num

            # Get rival move and legal_actions
            rival_move = []
            if len(card_play_action_seq) != 0:
                if len(card_play_action_seq[-1]) == 0:
                    rival_move = card_play_action_seq[-2]
                else:
                    rival_move = card_play_action_seq[-1]
            info_set.rival_move = rival_move
            info_set.legal_actions = _get_legal_card_play_actions(player_hand_cards, rival_move)

            # Prediction
            actions, actions_confidence = players[player_position].act(info_set)
            actions = [''.join([EnvCard2RealCard[a] for a in action]) for action in actions]
            result = {}
            win_rates = {}
            for i in range(len(actions)):
                # Here, we calculate the win rate
                win_rate = max(actions_confidence[i], -1)
                win_rate = min(win_rate, 1)
                win_rates[actions[i]] = str(round((win_rate + 1) / 2, 4))
                result[actions[i]] = str(round(actions_confidence[i], 6))

            ############## DEBUG ################
            if app.debug:
                print('--------------- DEBUG START --------------')
                command = 'curl --data "'
                parameters = []
                for key in request.form:
                    parameters.append(key+'='+request.form.get(key))
                    print(key+':', request.form.get(key))
                command += '&'.join(parameters)
                command += '" "http://127.0.0.1:5000/predict"'
                print('Command:', command)
                print('Rival Move:', rival_move)
                print('legal_actions:', info_set.legal_actions)
                print('Result:', result)
                print('--------------- DEBUG END --------------')
            ############## DEBUG ################
            return jsonify({'status': 0, 'message': 'success', 'result': result, 'win_rates': win_rates})
        except:
            import traceback
            traceback.print_exc()
            return jsonify({'status': -1, 'message': 'unkown error'})

@app.route('/legal', methods=['POST'])
def legal():
    if request.method == 'POST':
        try:
            player_hand_cards = [RealCard2EnvCard[c] for c in request.form.get('player_hand_cards')]
            rival_move = [RealCard2EnvCard[c] for c in request.form.get('rival_move')]
            legal_actions = _get_legal_card_play_actions(player_hand_cards, rival_move)
            legal_actions = ','.join([''.join([EnvCard2RealCard[a] for a in action]) for action in legal_actions])
            return jsonify({'status': 0, 'message': 'success', 'legal_action': legal_actions})
        except:
            import traceback
            traceback.print_exc()
            return jsonify({'status': -1, 'message': 'unkown error'})

class InfoSet(object):

    def __init__(self):
        self.player_position = None
        self.player_hand_cards = None
        self.num_cards_left = None
        self.three_landlord_cards = None
        self.card_play_action_seq = None
        self.other_hand_cards = None
        self.legal_actions = None
        self.rival_move = None
        self.last_moves = None
        self.played_cards = None
        self.bomb_num = None

def _get_legal_card_play_actions(player_hand_cards, rival_move):
    mg = MovesGener(player_hand_cards)

    rival_type = md.get_move_type(rival_move)
    rival_move_type = rival_type['type']
    rival_move_len = rival_type.get('len', 1)
    moves = list()

    if rival_move_type == md.TYPE_0_PASS:
        moves = mg.gen_moves()

    elif rival_move_type == md.TYPE_1_SINGLE:
        all_moves = mg.gen_type_1_single()
        moves = ms.filter_type_1_single(all_moves, rival_move)

    elif rival_move_type == md.TYPE_2_PAIR:
        all_moves = mg.gen_type_2_pair()
        moves = ms.filter_type_2_pair(all_moves, rival_move)

    elif rival_move_type == md.TYPE_3_TRIPLE:
        all_moves = mg.gen_type_3_triple()
        moves = ms.filter_type_3_triple(all_moves, rival_move)

    elif rival_move_type == md.TYPE_4_BOMB:
        all_moves = mg.gen_type_4_bomb() + mg.gen_type_5_king_bomb()
        moves = ms.filter_type_4_bomb(all_moves, rival_move)

    elif rival_move_type == md.TYPE_5_KING_BOMB:
        moves = []

    elif rival_move_type == md.TYPE_6_3_1:
        all_moves = mg.gen_type_6_3_1()
        moves = ms.filter_type_6_3_1(all_moves, rival_move)

    elif rival_move_type == md.TYPE_7_3_2:
        all_moves = mg.gen_type_7_3_2()
        moves = ms.filter_type_7_3_2(all_moves, rival_move)

    elif rival_move_type == md.TYPE_8_SERIAL_SINGLE:
        all_moves = mg.gen_type_8_serial_single(repeat_num=rival_move_len)
        moves = ms.filter_type_8_serial_single(all_moves, rival_move)

    elif rival_move_type == md.TYPE_9_SERIAL_PAIR:
        all_moves = mg.gen_type_9_serial_pair(repeat_num=rival_move_len)
        moves = ms.filter_type_9_serial_pair(all_moves, rival_move)

    elif rival_move_type == md.TYPE_10_SERIAL_TRIPLE:
        all_moves = mg.gen_type_10_serial_triple(repeat_num=rival_move_len)
        moves = ms.filter_type_10_serial_triple(all_moves, rival_move)

    elif rival_move_type == md.TYPE_11_SERIAL_3_1:
        all_moves = mg.gen_type_11_serial_3_1(repeat_num=rival_move_len)
        moves = ms.filter_type_11_serial_3_1(all_moves, rival_move)

    elif rival_move_type == md.TYPE_12_SERIAL_3_2:
        all_moves = mg.gen_type_12_serial_3_2(repeat_num=rival_move_len)
        moves = ms.filter_type_12_serial_3_2(all_moves, rival_move)

    elif rival_move_type == md.TYPE_13_4_2:
        all_moves = mg.gen_type_13_4_2()
        moves = ms.filter_type_13_4_2(all_moves, rival_move)

    elif rival_move_type == md.TYPE_14_4_22:
        all_moves = mg.gen_type_14_4_22()
        moves = ms.filter_type_14_4_22(all_moves, rival_move)

    if rival_move_type not in [md.TYPE_0_PASS,
                               md.TYPE_4_BOMB, md.TYPE_5_KING_BOMB]:
        moves = moves + mg.gen_type_4_bomb() + mg.gen_type_5_king_bomb()

    if len(rival_move) != 0:  # rival_move is not 'pass'
        moves = moves + [[]]

    for m in moves:
        m.sort()

    moves.sort()
    moves = list(move for move,_ in itertools.groupby(moves))

    return moves

def _paths():
    return (SCORE_FILE, PLAYERS_FILE, LOG_FILE, PLAYER_ID)


def _client_ip():
    """The address of the visitor. Behind Caddy the real address is in X-Forwarded-For."""
    forwarded = request.headers.get('X-Forwarded-For', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.remote_addr or ''


def _is_local():
    """True when the page is opened on this computer directly (not through a reverse proxy)."""
    return (request.remote_addr in ('127.0.0.1', '::1')
            and not request.headers.get('X-Forwarded-For') and not request.headers.get('X-Real-IP'))


def _player_id():
    """The ID that the page sends. The owner's ID only works on the computer itself."""
    body = request.get_json(silent=True) or {}
    player_id = body.get('id') or request.args.get('id') or ''
    if player_id == score_store.OWNER_ID and not _is_local():
        raise ValueError('unknown player')
    return player_id, body


def _bad(e):
    return jsonify({'status': 1, 'message': str(e)}), 400


@app.route('/player/init', methods=['POST'])
def player_init():
    body = request.get_json(silent=True) or {}
    return jsonify(score_store.init_player(_paths(), AI_NAMES, str(body.get('id') or ''), _client_ip(), _is_local()))


@app.route('/player/nickname', methods=['POST'])
def player_nickname():
    try:
        player_id, body = _player_id()
        return jsonify(score_store.set_nickname(_paths(), AI_NAMES, player_id, body.get('nickname'), _client_ip()))
    except (ValueError, TypeError) as e:
        return _bad(e)


@app.route('/score', methods=['GET'])
def get_score():
    try:
        player_id, _ = _player_id()
        return jsonify(score_store.snapshot(_paths(), AI_NAMES, player_id))
    except (ValueError, TypeError) as e:
        return _bad(e)


@app.route('/score/record', methods=['POST'])
def record_score():
    try:
        player_id, body = _player_id()
        deltas = [int(x) for x in body.get('deltas', [])]
        winners = [bool(x) for x in body.get('winners', [])]
        info = body.get('info') if isinstance(body.get('info'), dict) else {}
        return jsonify(score_store.record(_paths(), AI_NAMES, player_id, deltas, winners, info, _client_ip()))
    except (ValueError, TypeError) as e:
        return _bad(e)


@app.route('/score/reset', methods=['POST'])
def reset_score():
    try:
        player_id, _ = _player_id()
        return jsonify(score_store.reset(_paths(), AI_NAMES, player_id, _client_ip()))
    except (ValueError, TypeError) as e:
        return _bad(e)


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_web(path):
    """Serve the built web page, so that one process is all that is needed."""
    if not os.path.isfile(os.path.join(WEB_DIR, 'index.html')):
        return ('The web page files were not found in %s.\n'
                'This server only provides the API (POST /predict and /legal).' % WEB_DIR), 404
    if path == '':
        return redirect(GAME_PAGE)
    full_path = safe_join(WEB_DIR, path)
    if full_path is not None and os.path.isfile(full_path):
        return send_from_directory(WEB_DIR, path)
    if path.startswith('static/'):
        return 'Not found', 404
    # any other address is a route of the single-page app (e.g. /doudizhu): let it handle the address
    return send_from_directory(WEB_DIR, 'index.html')

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='DouZero backend')
    parser.add_argument('--debug', action='store_true')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=5000)
    args = parser.parse_args()
    if os.path.isfile(os.path.join(WEB_DIR, 'index.html')):
        print('\n  Open http://%s:%d%s in your browser.\n' % (args.host, args.port, GAME_PAGE))
    app.run(host=args.host, port=args.port, debug=args.debug)
