"""Scores and player records.

Three files are kept next to the program (all of them are written at the moment something happens, nothing waits
for a player to leave):

  score.json    the scores, per player ID: [you, right AI, left AI]. The game page reads this.  Do not edit by hand.
  players.json  one record per player (nickname, earlier nicknames, first / last visit, IPs, visits, games, wins).
  play.log      one line per event (visit, game, concede, reset, rename), appended, never rewritten.

Every file is written to a temporary file first and then moved over the old one, so a crash cannot leave a
half-written file. The log is only appended to; the worst case after a power cut is an incomplete last line.
"""
import json
import os
import re
import tempfile
import threading
import time
import uuid

_lock = threading.Lock()

OWNER_ID = 'owner'          # the player who uses the program on his own computer (not through a proxy)
MAX_NICKNAME = 8
MAX_IPS = 10
_ID_RE = re.compile(r'^[0-9a-f]{8,32}$|^owner$')
_DEAL_RE = re.compile(r'^[0-9a-f]{8}$')


def now_text():
    return time.strftime('%Y-%m-%d %H:%M:%S')


# ---------------------------------------------------------------- files
def _load(path, default):
    if not os.path.isfile(path):
        return default
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError('not an object')
        return data
    except (ValueError, OSError):
        # do not silently throw away a damaged file: keep it next to the new one
        os.replace(path, path + '.broken-%d' % int(time.time()))
        return default


def _save(path, data):
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or '.', suffix='.tmp')
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def _log(log_path, player_id, nickname, ip, event, detail=''):
    line = '%s  %s(%s)  %s  %s' % (now_text(), nickname or '-', player_id, ip or '-', event)
    if detail:
        line += '  ' + detail
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(line + '\n')


# ---------------------------------------------------------------- helpers
def clean_nickname(text):
    """No control characters (a newline would forge a log line), no leading / trailing spaces, at most 8 characters."""
    text = ''.join(ch for ch in str(text or '') if ch.isprintable())
    text = ' '.join(text.split())
    return text[:MAX_NICKNAME]


def valid_id(player_id):
    return isinstance(player_id, str) and bool(_ID_RE.match(player_id))


def _empty_player(nickname=''):
    t = now_text()
    return {
        'nickname': nickname,
        'previous_nicknames': [],
        'first_seen': t,
        'last_seen': t,
        'ips': [],
        'visits': 0,
        'games': 0,
        'wins': 0,
        'games_L': 0,
        'wins_L': 0,
        'games_P': 0,
        'wins_P': 0,
        'concedes': 0,
    }


def _touch(player, ip):
    player['last_seen'] = now_text()
    if ip:
        ips = [x for x in player.get('ips', []) if x != ip]
        ips.append(ip)
        player['ips'] = ips[-MAX_IPS:]


def _migrate_old_scores(score_path, ai_names, player_name):
    """The old score.json kept one shared table: {'players': {name: {'score': ..}}, 'history': [...]}.
    Keep its scores for the owner of the program; the game history is dropped."""
    data = _load(score_path, {})
    if 'scores' in data or 'players' not in data:
        return None
    old = data.get('players', {})
    get = lambda n: int((old.get(n) or {}).get('score', 0))
    return {OWNER_ID: [get(player_name)] + [get(n) for n in ai_names]}


def _scores_for(scores, player_id):
    s = scores.get(player_id)
    if not (isinstance(s, list) and len(s) == 3):
        s = [0, 0, 0]
    return [int(x) for x in s]


def _state(paths, ai_names):
    """Load both json files (and convert an old score.json)."""
    score_path, players_path = paths[0], paths[1]
    raw = _load(score_path, {})
    if 'scores' in raw:
        scores = raw['scores']
    else:
        scores = _migrate_old_scores(score_path, ai_names, paths[3]) or {}
    players = _load(players_path, {})
    return scores, players


def _write_scores(score_path, scores):
    _save(score_path, {'version': 2, 'scores': scores})


def _view(player_id, players, scores, ai_names):
    p = players.get(player_id) or {}
    return {
        'id': player_id,
        'nickname': p.get('nickname', ''),
        'names': [p.get('nickname', '')] + list(ai_names),
        'scores': _scores_for(scores, player_id),
    }


# ---------------------------------------------------------------- operations
# paths = (score.json, players.json, play.log, default name of the owner)
def init_player(paths, ai_names, player_id, ip, is_local):
    """Called once when the page is opened. Returns the player's record (a new ID is made when needed)."""
    score_path, players_path, log_path, owner_name = paths
    with _lock:
        scores, players = _state(paths, ai_names)
        created = False
        if is_local:
            player_id = OWNER_ID
        elif player_id == OWNER_ID or not valid_id(player_id) or player_id not in players:
            player_id = uuid.uuid4().hex[:12]    # a visitor can never become the owner by sending his ID
        if player_id not in players:
            players[player_id] = _empty_player(owner_name if player_id == OWNER_ID else '')
            created = True
        p = players[player_id]
        p['visits'] = int(p.get('visits', 0)) + 1
        _touch(p, ip)
        _save(players_path, players)
        if created or not os.path.isfile(score_path) or 'scores' not in _load(score_path, {}):
            scores.setdefault(player_id, [0, 0, 0])
            _write_scores(score_path, scores)
        _log(log_path, player_id, p.get('nickname'), ip, 'visit', 'new player' if created else '')
        return _view(player_id, players, scores, ai_names)


def set_nickname(paths, ai_names, player_id, nickname, ip):
    score_path, players_path, log_path, _ = paths
    nickname = clean_nickname(nickname)
    if not nickname:
        raise ValueError('the nickname is empty')
    with _lock:
        scores, players = _state(paths, ai_names)
        if player_id not in players:
            raise ValueError('unknown player')
        p = players[player_id]
        old = p.get('nickname', '')
        if old != nickname:
            if old:
                p.setdefault('previous_nicknames', []).append({'nickname': old, 'until': now_text()})
            p['nickname'] = nickname
            event, detail = ('rename', '%s -> %s' % (old or '-', nickname)) if old else ('nickname', nickname)
            _log(log_path, player_id, nickname, ip, event, detail)
        _touch(p, ip)
        _save(players_path, players)
        return _view(player_id, players, scores, ai_names)


def snapshot(paths, ai_names, player_id):
    with _lock:
        scores, players = _state(paths, ai_names)
        if player_id not in players:
            raise ValueError('unknown player')
        return _view(player_id, players, scores, ai_names)


def record(paths, ai_names, player_id, deltas, winners, info, ip):
    """deltas: 3 ints that sum to 0 (seat 0 = the human); winners: 3 bools."""
    score_path, players_path, log_path, _ = paths
    info = info if isinstance(info, dict) else {}
    # a normal game sums to 0; a concession only takes points from the human, so it need not
    concede = bool(info.get('concede'))
    # a code of the cards of this deal (from the page): the same code in two lines of play.log = the same cards
    deal = info.get('deal')
    deal_text = '  deal %s' % deal if isinstance(deal, str) and _DEAL_RE.match(deal) else ''
    if len(deltas) != 3 or len(winners) != 3 or (sum(deltas) != 0 and not concede):
        raise ValueError('deltas must be 3 integers that sum to 0')
    with _lock:
        scores, players = _state(paths, ai_names)
        if player_id not in players:
            raise ValueError('unknown player')
        p = players[player_id]
        s = _scores_for(scores, player_id)
        scores[player_id] = [s[i] + int(deltas[i]) for i in range(3)]
        won = bool(winners[0])
        p['games'] = int(p.get('games', 0)) + 1
        p['wins'] = int(p.get('wins', 0)) + (1 if won else 0)
        if concede:
            p['concedes'] = int(p.get('concedes', 0)) + 1
            detail = '%+d' % deltas[0] + deal_text
            _touch(p, ip)
            _write_scores(score_path, scores)
            _save(players_path, players)
            _log(log_path, player_id, p.get('nickname'), ip, 'concede', detail)
        else:
            role = 'L' if info.get('landlord') == 0 else 'P'
            p['games_' + role] = int(p.get('games_' + role, 0)) + 1
            p['wins_' + role] = int(p.get('wins_' + role, 0)) + (1 if won else 0)
            detail = '%s %s  %+d' % ('地主' if role == 'L' else '农民', '胜' if won else '负', deltas[0]) + deal_text
            _touch(p, ip)
            _write_scores(score_path, scores)
            _save(players_path, players)
            _log(log_path, player_id, p.get('nickname'), ip, 'game', detail)
        return _view(player_id, players, scores, ai_names)


def reset(paths, ai_names, player_id, ip):
    """Set the three scores of this player to 0. players.json keeps the statistics: they record what happened."""
    score_path, players_path, log_path, _ = paths
    with _lock:
        scores, players = _state(paths, ai_names)
        if player_id not in players:
            raise ValueError('unknown player')
        p = players[player_id]
        before = _scores_for(scores, player_id)
        scores[player_id] = [0, 0, 0]
        _touch(p, ip)
        _write_scores(score_path, scores)
        _save(players_path, players)
        _log(log_path, player_id, p.get('nickname'), ip, 'reset',
             'before: %s %+d, %s %+d, %s %+d' % (p.get('nickname') or '-', before[0], ai_names[0], before[1],
                                               ai_names[1], before[2]))
        return _view(player_id, players, scores, ai_names)
