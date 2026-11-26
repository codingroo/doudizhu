import { MenuItem, Select, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@material-ui/core';
import Button from '@material-ui/core/Button';
import Dialog from '@material-ui/core/Dialog';
import DialogActions from '@material-ui/core/DialogActions';
import DialogContent from '@material-ui/core/DialogContent';
import DialogTitle from '@material-ui/core/DialogTitle';
import Divider from '@material-ui/core/Divider';
import FormControlLabel from '@material-ui/core/FormControlLabel';
import FormGroup from '@material-ui/core/FormGroup';
import Paper from '@material-ui/core/Paper';
import Slider from '@material-ui/core/Slider';
import Switch from '@material-ui/core/Switch';
import TextField from '@material-ui/core/TextField';
import NotInterestedIcon from '@material-ui/icons/NotInterested';
import TranslateIcon from '@material-ui/icons/Translate';
import axios from 'axios';
import { Layout, Message } from 'element-react';
import qs from 'query-string';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '../../assets/doudizhu.scss';
import { DoudizhuGameBoard } from '../../components/GameBoard';
import {
    card2SuiteAndRank,
    computeHandCardsWidth,
    deepCopy,
    fullDoudizhuDeck,
    isDoudizhuBomb,
    shuffleArray,
    sortDoudizhuCards,
    translateCardData,
} from '../../utils';
import { douzeroDemoUrl } from '../../utils/config';
import { currentMultiplier, settle } from '../../utils/doudizhuScore';
import { pickPhrase } from '../../utils/doudizhuPhrase';
import { aiBid, applyBid, createBidState, landlordIdxToRole } from '../../utils/doudizhuBid';

let shuffledDoudizhuDeck = [];
let threeLandlordCards = [];
let originalThreeLandlordCards = [];
const initConsiderationTime = 30000;
const considerationTimeDeduction = 1000;
const mainPlayerId = 0; // index of main player (for the sake of simplify code logic)
let playerInfo = [];
let initHands = [[], [], []];
let firstBidder = 0; // who bids first in this deal
// A short code of the cards of this deal (8 hex digits, a hash of the three hands and the three bottom cards), written to
// play.log with the result: two games with the same code were played with the same cards. It is also in the result
// window, in the colour of the background (select it with the mouse to see it).
let dealId = '';
const computeDealId = () => {
    const text = [initHands[0], initHands[1], initHands[2], originalThreeLandlordCards]
        .map((cards) => cards.slice().sort().join(''))
        .join('|');
    let h = 0x811c9dc5; // FNV-1a, 32 bit
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
};

// Deal snapshot: F5 restores the same deal (the bidding starts again), a new tab / a closed tab starts a new deal.
// Kept in sessionStorage, removed when the game ends or when the player concedes. Raise the version when the layout changes.
const SNAPSHOT_KEY = 'DOUDIZHU_DEAL_SNAPSHOT';
const SNAPSHOT_VERSION = 1;
const saveSnapshot = () => {
    try {
        sessionStorage.setItem(
            SNAPSHOT_KEY,
            JSON.stringify({
                version: SNAPSHOT_VERSION,
                hands: initHands,
                three: originalThreeLandlordCards,
                firstBidder,
                savedAt: Date.now(),
            }),
        );
    } catch (e) {
        // storage not available: the game still works, only F5 gives a new deal
    }
};
const clearSnapshot = () => {
    try {
        sessionStorage.removeItem(SNAPSHOT_KEY);
    } catch (e) {
        // ignore
    }
};
const loadSnapshot = () => {
    try {
        const raw = sessionStorage.getItem(SNAPSHOT_KEY);
        if (!raw) return false;
        const snap = JSON.parse(raw);
        if (!snap || snap.version !== SNAPSHOT_VERSION) return false;
        // a deal older than this is not restored (public/settings.js: dealKeepMinutes, 10 by default), so a page that
        // was left alone for a while starts with a new deal
        const settings = window.DOUDIZHU_SETTINGS || {};
        const keepMinutes = typeof settings.dealKeepMinutes === 'number' ? settings.dealKeepMinutes : 10;
        const age = Date.now() - snap.savedAt;
        if (typeof snap.savedAt !== 'number' || age < 0 || age > keepMinutes * 60 * 1000) return false;
        const all = [].concat(snap.hands[0], snap.hands[1], snap.hands[2], snap.three);
        const valid =
            snap.hands.length === 3 &&
            snap.hands.every((h) => Array.isArray(h) && h.length === 17) &&
            snap.three.length === 3 &&
            all.length === 54 &&
            new Set(all).size === 54 &&
            all.every((c) => fullDoudizhuDeck.indexOf(c) >= 0) &&
            [0, 1, 2].indexOf(snap.firstBidder) >= 0;
        if (!valid) return false;
        initHands = snap.hands;
        threeLandlordCards = snap.three.slice();
        originalThreeLandlordCards = snap.three.slice();
        firstBidder = snap.firstBidder;
        dealId = computeDealId();
        return true;
    } catch (e) {
        return false;
    }
};

// shuffle and deal a new game (also used when all three players pass during bidding)
const dealNewGame = () => {
    shuffledDoudizhuDeck = shuffleArray(fullDoudizhuDeck.slice());

    threeLandlordCards = shuffleArray(sortDoudizhuCards(shuffledDoudizhuDeck.slice(0, 3)));
    originalThreeLandlordCards = threeLandlordCards.slice();

    initHands = [
        shuffledDoudizhuDeck.slice(3, 20),
        shuffledDoudizhuDeck.slice(20, 37),
        shuffledDoudizhuDeck.slice(37, 54),
    ];
    firstBidder = Math.floor(Math.random() * 3);
    dealId = computeDealId();
    saveSnapshot();
};

if (!loadSnapshot()) dealNewGame();

// bumped when a game is abandoned (concede / new game): answers of the AI that are still on their way are dropped
let gameToken = 0;

console.log('init hands', initHands);
console.log('three landlord card', threeLandlordCards);

// settings that can be changed in public/settings.js without rebuilding the page
const getSetting = (name, fallback) => {
    const settings = window.DOUDIZHU_SETTINGS || {};
    return settings[name] === undefined ? fallback : settings[name];
};

let gameStateTimeout = null;

let gameHistory = [];
let bombNum = 0;
let bombCounts = [0, 0, 0]; // how many bombs / rockets each seat has played, for the result comment
let playCounts = [0, 0, 0]; // how many times each seat has played cards (passes excluded), for spring detection
let finalBid = { landlordIdx: -1, points: 0 };
let playerNames = ['You', 'AI-R', 'AI-L']; // replaced by the names sent by the backend (your nickname and the AI names)
// the ID of this browser's player, made by the backend the first time and kept in localStorage; the scores are kept
// per ID, so that friends who play on the same server have their own scores
const PLAYER_ID_KEY = 'DOUDIZHU_PLAYER_ID';
let myPlayerId = '';
const NICKNAME_MAX = 8;
let lastMoveLandlord = [];
let lastMoveLandlordDown = [];
let lastMoveLandlordUp = [];
let playedCardsLandlord = [];
let playedCardsLandlordDown = [];
let playedCardsLandlordUp = [];
let legalActions = { turn: -1, actions: [] };
let hintIdx = -1;
let hintBest = { turn: -2, token: -1, action: '' }; // the answer of the model for the hint in this turn
let gameEndDialogTitle = '';
let resultPhrase = null; // comment for the result window, from public/phrases.js
let syncGameStatus = 'ready';

function PvEDoudizhuDemoView() {
    const { t, i18n } = useTranslation();
    // initial value of the "AI thinking time" slider; must be one of the slider's steps (see public/settings.js)
    const [apiPlayDelay, setApiPlayDelay] = useState(() => {
        const wanted = getSetting('aiThinkingTimeMs', 0);
        return [0, 1000, 3000, 5000, 10000, 30000].indexOf(wanted) >= 0 ? wanted : 3000;
    });
    const [isGameEndDialogOpen, setIsGameEndDialogOpen] = useState(false);
    const [considerationTime, setConsiderationTime] = useState(initConsiderationTime);
    const [toggleFade, setToggleFade] = useState('');
    const [gameStatus, setGameStatus] = useState('ready'); // "localeSelection", "ready", "bidding", "playing", "paused", "over"
    const [gameState, setGameState] = useState({
        hands: [[], [], []],
        latestAction: [[], [], []],
        currentPlayer: null, // index of current player
        turn: 0,
    });
    const [selectedCards, setSelectedCards] = useState([]); // user selected hand card
    const [isPassDisabled, setIsPassDisabled] = useState(true);
    const [isHintDisabled, setIsHintDisabled] = useState(true);
    const [, setLegalVersion] = useState(0); // changed whenever a list of legal actions arrives (to redraw the play button)
    const [predictionRes, setPredictionRes] = useState({ prediction: [], hands: [] });
    const [hideRivalHand, setHideRivalHand] = useState(true);
    const [hidePredictionArea, setHidePredictionArea] = useState(true);
    const [locale, setLocale] = useState(localStorage.getItem('LOCALE') || 'zh');
    const [statisticRows, setStatisticRows] = useState([]);
    const [bidState, setBidState] = useState(createBidState(null)); // state of the bidding phase
    const [scoreData, setScoreData] = useState(null); // names and cumulative scores of this player, kept by the backend
    const [nicknameDialog, setNicknameDialog] = useState({ open: false, required: false }); // required: first visit
    const [nicknameInput, setNicknameInput] = useState('');
    const [nickAnchor, setNickAnchor] = useState(null); // centre of the table, where the nickname window goes
    const [isClearScoreDialogOpen, setIsClearScoreDialogOpen] = useState(false);
    const [dialogAnchor, setDialogAnchor] = useState(null); // horizontal centre and top of the table, where the result window goes
    const [settlement, setSettlement] = useState(null); // result of the game that has just ended
    const [viewScale, setViewScale] = useState(1);
    const [viewWidth, setViewWidth] = useState(1000);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const cardArr2DouzeroFormat = (cards) => {
        return cards
            .map((card) => {
                if (card === 'RJ') return 'D';
                if (card === 'BJ') return 'X';
                return card[1];
            })
            .join('');
    };

    // Is this selection a legal play right now? It is the same test that the play button used to do at the click, with the
    // list of legal actions of this turn that the backend sent (one lookup in a set: it costs next to nothing).
    const isLegalSelection = (cards) => {
        if (!cards || cards.length === 0) return false;
        if (gameState.currentPlayer !== mainPlayerId || gameState.turn !== legalActions.turn) return false;
        if (!legalActions.set) legalActions.set = new Set(legalActions.actions);
        return legalActions.set.has(cardArr2DouzeroFormat(sortDoudizhuCards(cards, true)));
    };

    function timeout(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    const proceedNextTurn = async (playingCard, rankOnly = true) => {
        const token = gameToken;
        // take played three landlord card out
        if (playerInfo[gameState.currentPlayer].role === 'landlord' && threeLandlordCards.length > 0) {
            let playingCardCopy;
            if (rankOnly) playingCardCopy = playingCard.slice();
            else
                playingCardCopy = playingCard.map((card) => {
                    const { rank } = card2SuiteAndRank(card);
                    return rank;
                });
            threeLandlordCards = threeLandlordCards.filter((card) => {
                const { rank } = card2SuiteAndRank(card);
                const idx = playingCardCopy.indexOf(rank);
                if (idx >= 0) {
                    playingCardCopy.splice(idx, 1);
                    return false;
                } else return true;
            });
        }

        // if next player is user, get legal actions
        if ((gameState.currentPlayer + 1) % 3 === mainPlayerId) {
            hintIdx = -1;
            const player_hand_cards = cardArr2DouzeroFormat(gameState.hands[mainPlayerId].slice().reverse());
            let rival_move = '';
            if (playingCard.length === 0) {
                rival_move = cardArr2DouzeroFormat(sortDoudizhuCards(gameHistory[gameHistory.length - 1], true));
            } else {
                rival_move = rankOnly ? playingCard.join('') : cardArr2DouzeroFormat(playingCard);
            }
            const requestBody = {
                player_hand_cards,
                rival_move,
            };
            let apiRes;
            try {
                apiRes = await axios.post(`${douzeroDemoUrl}/legal`, qs.stringify(requestBody));
            } catch (err) {
                if (token === gameToken) {
                    Message({
                        message: t('doudizhu.msg_network_error'),
                        type: 'error',
                        showClose: true,
                    });
                }
                return;
            }
            if (token !== gameToken) return;
            const data = apiRes.data;
            legalActions = {
                turn: gameState.turn + 1,
                actions: data.legal_action.split(','),
            };
            setLegalVersion((v) => v + 1);
            setIsHintDisabled(data.legal_action === '');
            setIsPassDisabled(playingCard.length === 0 && gameHistory[gameHistory.length - 1].length === 0);
        }

        // delay play for api player
        if (gameState.currentPlayer !== mainPlayerId) {
            await timeout(apiPlayDelay);
            if (token !== gameToken) return;
        }

        setToggleFade('fade-out');

        let newGameState = deepCopy(gameState);

        // take played card out from hand, and generate playing cards with suite
        const currentHand = newGameState.hands[gameState.currentPlayer];
        let newHand;
        let newLatestAction = [];
        if (playingCard.length === 0) {
            newHand = currentHand;
            newLatestAction = 'pass';
        } else if (rankOnly) {
            newHand = currentHand.filter((card) => {
                if (playingCard.length === 0) return true;

                const { rank } = card2SuiteAndRank(card);
                const idx = playingCard.indexOf(rank);
                if (idx >= 0) {
                    playingCard.splice(idx, 1);
                    newLatestAction.push(card);
                    return false;
                }
                return true;
            });
        } else {
            newLatestAction = playingCard.slice();
            newHand = currentHand.filter((card) => {
                if (playingCard.length === 0) return true;

                const idx = playingCard.indexOf(card);
                if (idx >= 0) {
                    playingCard.splice(idx, 1);
                    return false;
                }
                return true;
            });
        }

        // update value records for douzero
        const newHistoryRecord = sortDoudizhuCards(newLatestAction === 'pass' ? [] : newLatestAction, true);
        switch (playerInfo[gameState.currentPlayer].douzeroPlayerPosition) {
            case 0:
                lastMoveLandlord = newHistoryRecord;
                playedCardsLandlord = playedCardsLandlord.concat(newHistoryRecord);
                break;
            case 1:
                lastMoveLandlordDown = newHistoryRecord;
                playedCardsLandlordDown = playedCardsLandlordDown.concat(newHistoryRecord);
                break;
            case 2:
                lastMoveLandlordUp = newHistoryRecord;
                playedCardsLandlordUp = playedCardsLandlordUp.concat(newHistoryRecord);
                break;
            default:
                break;
        }
        gameHistory.push(newHistoryRecord);
        if (isDoudizhuBomb(newHistoryRecord)) {
            bombNum++;
            bombCounts[gameState.currentPlayer]++;
        }
        if (newHistoryRecord.length > 0) playCounts[gameState.currentPlayer]++;

        newGameState.latestAction[gameState.currentPlayer] = newLatestAction;
        newGameState.hands[gameState.currentPlayer] = newHand;
        newGameState.currentPlayer = (newGameState.currentPlayer + 1) % 3;
        newGameState.turn++;
        if (newHand.length === 0) {
            setGameStatus('over');
            syncGameStatus = 'over';
        }
        setGameState(newGameState);
        setToggleFade('fade-in');
        setTimeout(() => {
            setToggleFade('');
        }, 200);

        if (gameStateTimeout) {
            clearTimeout(gameStateTimeout);
        }

        if (newHand.length === 0) {
            setHideRivalHand(false);
            const winner = playerInfo[gameState.currentPlayer];

            // update game overall history
            const gameStatistics = localStorage.getItem('GAME_STATISTICS')
                ? JSON.parse(localStorage.getItem('GAME_STATISTICS'))
                : {
                      totalGameNum: 0,
                      totalWinNum: 0,
                      landlordGameNum: 0,
                      landlordWinNum: 0,
                      landlordUpGameNum: 0,
                      landlordUpWinNum: 0,
                      landlordDownGameNum: 0,
                      landlordDownWinNum: 0,
                  };

            gameStatistics.totalGameNum += 1;
            switch (playerInfo[mainPlayerId].douzeroPlayerPosition) {
                case 0:
                    gameStatistics.landlordGameNum += 1;
                    if (winner.role === playerInfo[mainPlayerId].role) {
                        gameStatistics.totalWinNum += 1;
                        gameStatistics.landlordWinNum += 1;
                    }
                    break;
                case 1:
                    gameStatistics.landlordDownGameNum += 1;
                    if (winner.role === playerInfo[mainPlayerId].role) {
                        gameStatistics.totalWinNum += 1;
                        gameStatistics.landlordDownWinNum += 1;
                    }
                    break;
                case 2:
                    gameStatistics.landlordUpGameNum += 1;
                    if (winner.role === playerInfo[mainPlayerId].role) {
                        gameStatistics.totalWinNum += 1;
                        gameStatistics.landlordUpWinNum += 1;
                    }
                    break;
                default:
                    Message({
                        message: t('doudizhu.msg_network_error'),
                        type: 'error',
                        showClose: true,
                    });
            }
            localStorage.setItem('GAME_STATISTICS', JSON.stringify(gameStatistics));

            clearSnapshot();
            // score settlement: base score x multiplier, saved by the backend so that it survives a restart
            if (finalBid.landlordIdx >= 0) {
                const result = settle({
                    base: finalBid.points,
                    landlordIdx: finalBid.landlordIdx,
                    winnerIdx: gameState.currentPlayer,
                    bombCount: bombNum,
                    playCounts: playCounts.slice(),
                });
                setSettlement(result);
                const winners = [0, 1, 2].map((i) => (i === result.landlordIdx) === result.landlordWon);
                // the comment in the result window (rules: public/phrases.js); only for the Chinese interface
                const youWon = winners[mainPlayerId];
                resultPhrase = pickPhrase({
                    win: youWon,
                    lose: !youWon,
                    landlord: result.landlordIdx === mainPlayerId,
                    peasant: result.landlordIdx !== mainPlayerId,
                    bomb: result.bombCount,
                    self_bomb: bombCounts[mainPlayerId],
                    other_bomb: result.bombCount - bombCounts[mainPlayerId],
                    spring: result.spring,
                    reverse_spring: result.antiSpring,
                    hand_left: newGameState.hands[mainPlayerId].length,
                    base: result.base,
                    multiplier: result.multiplier,
                });
                axios
                    .post(`${douzeroDemoUrl}/score/record`, {
                        id: myPlayerId,
                        deltas: result.deltas,
                        winners,
                        info: {
                            base: result.base,
                            multiplier: result.multiplier,
                            bombs: result.bombCount,
                            spring: result.spring,
                            antiSpring: result.antiSpring,
                            landlord: result.landlordIdx,
                            deal: dealId,
                        },
                    })
                    .then((res) => setScoreData(res.data))
                    .catch(() =>
                        Message({
                            message: t('doudizhu.msg_network_error'),
                            type: 'error',
                            showClose: true,
                        }),
                    );
            }

            setTimeout(() => {
                gameEndDialogTitle =
                    (i18n.language || '').startsWith('zh') && resultPhrase
                        ? resultPhrase
                        : winner.role === 'peasant'
                        ? t('doudizhu.peasants_win')
                        : t('doudizhu.landlord_win');
                setStatisticRows([
                    {
                        role: t('doudizhu.landlord'),
                        win: gameStatistics.landlordWinNum,
                        total: gameStatistics.landlordGameNum,
                        winRate: gameStatistics.landlordGameNum
                            ? ((gameStatistics.landlordWinNum / gameStatistics.landlordGameNum) * 100).toFixed(2) + '%'
                            : '-',
                    },
                    {
                        role: t('doudizhu.landlord_up'),
                        win: gameStatistics.landlordUpWinNum,
                        total: gameStatistics.landlordUpGameNum,
                        winRate: gameStatistics.landlordUpGameNum
                            ? ((gameStatistics.landlordUpWinNum / gameStatistics.landlordUpGameNum) * 100).toFixed(2) +
                              '%'
                            : '-',
                    },
                    {
                        role: t('doudizhu.landlord_down'),
                        win: gameStatistics.landlordDownWinNum,
                        total: gameStatistics.landlordDownGameNum,
                        winRate: gameStatistics.landlordDownGameNum
                            ? ((gameStatistics.landlordDownWinNum / gameStatistics.landlordDownGameNum) * 100).toFixed(
                                  2,
                              ) + '%'
                            : '-',
                    },
                    {
                        role: 'All',
                        win: gameStatistics.totalWinNum,
                        total: gameStatistics.totalGameNum,
                        winRate: gameStatistics.totalGameNum
                            ? ((gameStatistics.totalWinNum / gameStatistics.totalGameNum) * 100).toFixed(2) + '%'
                            : '-',
                    },
                ]);

                // put the result window over the right-hand panel, so that the table and the last cards stay visible
                const table = document.querySelector('.doudizhu-gameboard-paper');
                if (table) {
                    const rect = table.getBoundingClientRect();
                    // top edge of the result window: --dz-dialog-top (public/custom.css) below the top of the table
                    let offset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dz-dialog-top'));
                    if (!(offset >= 0)) offset = 100;
                    const zoom = parseFloat(document.querySelector('.doudizhu-view-container').style.zoom) || 1;
                    setDialogAnchor({ x: rect.left + rect.width / 2, y: rect.top + offset * zoom });
                } else setDialogAnchor(null);
                setIsGameEndDialogOpen(true);
            }, getSetting('resultDelayMs', 100));
        } else {
            setConsiderationTime(initConsiderationTime);
            // manually trigger timer if consideration time equals initConsiderationTime
            if (initConsiderationTime === considerationTime) gameStateTimer();
        }
    };

    // the request for the backend's /predict: the situation of the player whose turn it is (the AI, or you for the hint)
    const buildPredictBody = () => {
        // gather information for api request
        const player_position = playerInfo[gameState.currentPlayer].douzeroPlayerPosition;
        const player_hand_cards = cardArr2DouzeroFormat(gameState.hands[gameState.currentPlayer].slice().reverse());
        const num_cards_left_landlord =
            gameState.hands[playerInfo.find((player) => player.douzeroPlayerPosition === 0).index].length;
        const num_cards_left_landlord_down =
            gameState.hands[playerInfo.find((player) => player.douzeroPlayerPosition === 1).index].length;
        const num_cards_left_landlord_up =
            gameState.hands[playerInfo.find((player) => player.douzeroPlayerPosition === 2).index].length;
        const three_landlord_cards = cardArr2DouzeroFormat(threeLandlordCards.slice().reverse());
        const card_play_action_seq = gameHistory
            .map((cards) => {
                return cardArr2DouzeroFormat(cards);
            })
            .join(',');
        const other_hand_cards = cardArr2DouzeroFormat(
            sortDoudizhuCards(
                gameState.hands[(gameState.currentPlayer + 1) % 3].concat(
                    gameState.hands[(gameState.currentPlayer + 2) % 3],
                ),
                true,
            ),
        );
        const last_move_landlord = cardArr2DouzeroFormat(lastMoveLandlord.slice().reverse());
        const last_move_landlord_down = cardArr2DouzeroFormat(lastMoveLandlordDown.slice().reverse());
        const last_move_landlord_up = cardArr2DouzeroFormat(lastMoveLandlordUp.slice().reverse());
        const bomb_num = bombNum;
        const played_cards_landlord = cardArr2DouzeroFormat(playedCardsLandlord);
        const played_cards_landlord_down = cardArr2DouzeroFormat(playedCardsLandlordDown);
        const played_cards_landlord_up = cardArr2DouzeroFormat(playedCardsLandlordUp);

        const requestBody = {
            player_position,
            player_hand_cards,
            num_cards_left_landlord,
            num_cards_left_landlord_down,
            num_cards_left_landlord_up,
            three_landlord_cards,
            card_play_action_seq,
            other_hand_cards,
            last_move_landlord,
            last_move_landlord_down,
            last_move_landlord_up,
            bomb_num,
            played_cards_landlord,
            played_cards_landlord_down,
            played_cards_landlord_up,
        };
        return requestBody;
    };

    const requestApiPlay = async () => {
        const token = gameToken;
        const requestBody = buildPredictBody();

        try {
            const apiRes = await axios.post(`${douzeroDemoUrl}/predict`, qs.stringify(requestBody));
            if (token !== gameToken) return;
            const data = apiRes.data;

            if (data.status !== 0) {
                if (data.status === -1) {
                    // check if no legal action or only one legal action can be made
                    const player_hand_cards = cardArr2DouzeroFormat(
                        gameState.hands[gameState.currentPlayer].slice().reverse(),
                    );
                    let rival_move = '';
                    if (gameHistory[gameHistory.length - 1].length > 0) {
                        rival_move = cardArr2DouzeroFormat(
                            sortDoudizhuCards(gameHistory[gameHistory.length - 1], true),
                        );
                    } else if (gameHistory.length >= 2 && gameHistory[gameHistory.length - 2].length > 0) {
                        rival_move = cardArr2DouzeroFormat(
                            sortDoudizhuCards(gameHistory[gameHistory.length - 2], true),
                        );
                    }
                    const requestBody = {
                        player_hand_cards,
                        rival_move,
                    };
                    const apiRes = await axios.post(`${douzeroDemoUrl}/legal`, qs.stringify(requestBody));
                    if (token !== gameToken) return;
                    if (apiRes.data.legal_action === '') {
                        proceedNextTurn([]);
                        setPredictionRes({
                            prediction: [['', t('doudizhu.only_choice')]],
                            hands: gameState.hands[gameState.currentPlayer].slice(),
                        });
                    } else if (apiRes.data.legal_action.split(',').length === 1) {
                        proceedNextTurn(apiRes.data.legal_action.split(''));
                        setPredictionRes({
                            prediction: [[apiRes.data.legal_action, t('doudizhu.only_choice')]],
                            hands: gameState.hands[gameState.currentPlayer].slice(),
                        });
                    } else {
                        Message({
                            message: t('doudizhu.msg_network_error'),
                            type: 'error',
                            showClose: true,
                        });
                    }
                } else {
                    Message({
                        message: `Error: ${apiRes.data.message}`,
                        type: 'error',
                        showClose: true,
                    });
                }
            } else {
                let bestAction = '';
                if (data.result && Object.keys(data.result).length > 0) {
                    const sortedResult = Object.entries(data.result).sort((a, b) => {
                        return Number(b[1]) - Number(a[1]);
                    });
                    setPredictionRes({
                        prediction: sortedResult.map((result) => {
                            return [result[0], data.win_rates[result[0]]];
                        }),
                        hands: gameState.hands[gameState.currentPlayer].slice(),
                    });
                    if (Object.keys(data.result).length === 1) bestAction = Object.keys(data.result)[0];
                    else {
                        bestAction = Object.keys(data.result)[0];
                        let bestConfidence = Number(data.result[Object.keys(data.result)[0]]);
                        for (let i = 1; i < Object.keys(data.result).length; i++) {
                            if (Number(data.result[Object.keys(data.result)[i]]) > bestConfidence) {
                                bestAction = Object.keys(data.result)[i];
                                bestConfidence = Number(data.result[Object.keys(data.result)[i]]);
                            }
                        }
                    }
                }
                proceedNextTurn(bestAction.split(''));
            }
        } catch (err) {
            Message({
                message: t('doudizhu.msg_network_error'),
                type: 'error',
                showClose: true,
            });
        }
    };

    const toggleHidePredictionArea = () => {
        setHideRivalHand(!hideRivalHand);
        setHidePredictionArea(!hidePredictionArea);
    };

    const handleSelectedCards = (cards) => {
        let newSelectedCards = selectedCards.slice();
        cards.forEach((card) => {
            if (newSelectedCards.indexOf(card) >= 0) {
                newSelectedCards.splice(newSelectedCards.indexOf(card), 1);
            } else {
                newSelectedCards.push(card);
            }
        });
        setSelectedCards(newSelectedCards);
    };

    const handleSelectRole = (role) => {
        const playerInfoTemplate = [
            {
                id: 0,
                index: 0,
                role: 'peasant',
                douzeroPlayerPosition: -1,
                agentInfo: { name: playerNames[0] },
            },
            {
                id: 1,
                index: 1,
                role: 'peasant',
                douzeroPlayerPosition: -1,
                agentInfo: { name: playerNames[1] },
            },
            {
                id: 2,
                index: 2,
                role: 'peasant',
                douzeroPlayerPosition: -1,
                agentInfo: { name: playerNames[2] },
            },
        ];
        switch (role) {
            case 'landlord_up':
                playerInfo = deepCopy(playerInfoTemplate);
                playerInfo[1].role = 'landlord';
                break;
            case 'landlord':
                playerInfo = deepCopy(playerInfoTemplate);
                playerInfo[0].role = 'landlord';
                break;
            case 'landlord_down':
                playerInfo = deepCopy(playerInfoTemplate);
                playerInfo[2].role = 'landlord';
                break;
            default:
                break;
        }
        const landlordIdx = playerInfo.find((player) => player.role === 'landlord').index;
        playerInfo[landlordIdx].douzeroPlayerPosition = 0;
        playerInfo[(landlordIdx + 1) % 3].douzeroPlayerPosition = 1;
        playerInfo[(landlordIdx + 2) % 3].douzeroPlayerPosition = 2;
        initHands[landlordIdx] = initHands[landlordIdx].concat(threeLandlordCards.slice());
        setGameStatus('playing');
        syncGameStatus = 'playing';
    };

    // ---- bidding phase (叫分): runs between "ready" and "playing" ----
    const startBidding = () => {
        // every seat is a peasant until the bidding is over, the board needs this to lay out the three seats
        playerInfo = [0, 1, 2].map((i) => ({
            id: i,
            index: i,
            role: 'peasant',
            douzeroPlayerPosition: -1,
            agentInfo: { name: playerNames[i] },
        }));
        // show the hands that have been dealt (17 cards each, the three bottom cards stay hidden)
        setGameState({
            hands: initHands.map((hand) => sortDoudizhuCards(hand)),
            latestAction: [[], [], []],
            currentPlayer: null,
            turn: 0,
        });
        setBidState(createBidState(firstBidder));
        setGameStatus('bidding');
        syncGameStatus = 'bidding';
    };

    const redealAndBid = () => {
        dealNewGame();
        startBidding();
    };

    const handleBid = (bid) => {
        setBidState(applyBid(bidState, mainPlayerId, bid));
    };

    // "直接认输": the player loses 3 points at once, nothing else changes. Only possible while the bidding is going on:
    // once the cards are being played a lost game costs more than 3 points, so conceding would be a cheap way out.
    const CONCEDE_POINTS = 3;
    const handleConcede = () => {
        if (gameStatus !== 'bidding') return;
        gameToken++; // answers of the AI that are still on their way are dropped
        if (gameStateTimeout) clearTimeout(gameStateTimeout);
        clearSnapshot();
        const landlordIdx = finalBid.landlordIdx; // -1 while the bidding is still going on
        const base = landlordIdx >= 0 ? finalBid.points : 0;
        const multiplier = Math.pow(2, bombNum);
        const result = {
            concede: true,
            base,
            multiplier,
            bombCount: bombNum,
            spring: false,
            antiSpring: false,
            landlordIdx,
            landlordWon: false,
            deltas: [-CONCEDE_POINTS, 0, 0],
        };
        setSettlement(result);
        resultPhrase = pickPhrase({
            win: false,
            lose: true,
            concede: true,
            landlord: landlordIdx === mainPlayerId,
            peasant: landlordIdx >= 0 && landlordIdx !== mainPlayerId,
            bomb: bombNum,
            self_bomb: bombCounts[mainPlayerId],
            other_bomb: bombNum - bombCounts[mainPlayerId],
            spring: false,
            reverse_spring: false,
            hand_left: gameState.hands[mainPlayerId].length,
            base,
            multiplier,
        });
        gameEndDialogTitle =
            (i18n.language || '').startsWith('zh') && resultPhrase ? resultPhrase : t('doudizhu.concede_title');
        setGameStatus('over');
        syncGameStatus = 'over';
        setHideRivalHand(false);
        setIsPassDisabled(true);
        setIsHintDisabled(true);
        setSelectedCards([]);
        axios
            .post(`${douzeroDemoUrl}/score/record`, {
                id: myPlayerId,
                deltas: result.deltas,
                winners: [false, false, false],
                info: { concede: true, base, multiplier, bombs: bombNum, landlord: landlordIdx, deal: dealId },
            })
            .then((res) => setScoreData(res.data))
            .catch(() =>
                Message({ message: t('doudizhu.msg_network_error'), type: 'error', showClose: true }),
            );
        const table = document.querySelector('.doudizhu-gameboard-paper');
        if (table) {
            const rect = table.getBoundingClientRect();
            let offset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dz-dialog-top'));
            if (!(offset >= 0)) offset = 100;
            const zoom = parseFloat(document.querySelector('.doudizhu-view-container').style.zoom) || 1;
            setDialogAnchor({ x: rect.left + rect.width / 2, y: rect.top + offset * zoom });
        } else setDialogAnchor(null);
        setTimeout(() => setIsGameEndDialogOpen(true), getSetting('resultDelayMs', 100));
    };

    const gameStateTimer = () => {
        gameStateTimeout = setTimeout(() => {
            let currentConsiderationTime = considerationTime;
            if (currentConsiderationTime > 0) {
                currentConsiderationTime -= considerationTimeDeduction;
                currentConsiderationTime = Math.max(currentConsiderationTime, 0);
                setConsiderationTime(currentConsiderationTime);
            } else {
                // consideration time used up for current player
                // if current player is controlled by user, play a random card
                // todo
            }
        }, considerationTimeDeduction);
    };

    const handleResetStatistics = () => {
        localStorage.removeItem('GAME_STATISTICS');
        setStatisticRows([
            {
                role: t('doudizhu.landlord'),
                win: 0,
                total: 0,
                winRate: '-',
            },
            {
                role: t('doudizhu.landlord_up'),
                win: 0,
                total: 0,
                winRate: '-',
            },
            {
                role: t('doudizhu.landlord_down'),
                win: 0,
                total: 0,
                winRate: '-',
            },
            {
                role: 'All',
                win: 0,
                total: 0,
                winRate: '-',
            },
        ]);
    };

    const handleCloseGameEndDialog = () => {
        // reset all game state for new game
        gameToken++;
        dealNewGame();

        playerInfo = [];

        gameStateTimeout = null;
        gameHistory = [];
        bombNum = 0;
        bombCounts = [0, 0, 0];
        playCounts = [0, 0, 0];
        finalBid = { landlordIdx: -1, points: 0 };
        setSettlement(null);
        resultPhrase = null;
        lastMoveLandlord = [];
        lastMoveLandlordDown = [];
        lastMoveLandlordUp = [];
        playedCardsLandlord = [];
        playedCardsLandlordDown = [];
        playedCardsLandlordUp = [];
        legalActions = { turn: -1, actions: [] };

        setConsiderationTime(initConsiderationTime);
        setToggleFade('');
        setIsPassDisabled(true);
        setIsHintDisabled(true);
        setGameState({
            hands: [[], [], []],
            latestAction: [[], [], []],
            currentPlayer: null, // index of current player
            turn: 0,
        });
        setSelectedCards([]); // user selected hand card
        setPredictionRes({ prediction: [], hands: [] });
        setHideRivalHand(hidePredictionArea);
        setBidState(createBidState(null));

        setGameStatus('ready');
        syncGameStatus = 'ready';
        setIsGameEndDialogOpen(false);
    };

    const startGame = async () => {
        // start game
        const token = gameToken;
        setGameStatus('playing');
        syncGameStatus = 'playing';
        const newGameState = deepCopy(gameState);
        // find landord to be the first player
        newGameState.currentPlayer = playerInfo.find((element) => element.role === 'landlord').index;
        newGameState.hands = initHands.map((element) => sortDoudizhuCards(element));

        // if first player is user, fetch legal actions
        if (newGameState.currentPlayer === mainPlayerId) {
            const player_hand_cards = cardArr2DouzeroFormat(newGameState.hands[mainPlayerId].slice().reverse());
            let rival_move = '';
            const requestBody = {
                player_hand_cards,
                rival_move,
            };
            let apiRes;
            try {
                apiRes = await axios.post(`${douzeroDemoUrl}/legal`, qs.stringify(requestBody));
            } catch (err) {
                if (token === gameToken) {
                    Message({
                        message: t('doudizhu.msg_network_error'),
                        type: 'error',
                        showClose: true,
                    });
                }
                return;
            }
            if (token !== gameToken) return;
            const data = apiRes.data;
            legalActions = {
                turn: 0,
                actions: data.legal_action.split(','),
            };
            setLegalVersion((v) => v + 1);
            setIsHintDisabled(data.legal_action === '');
        }

        setGameState(newGameState);
        gameStateTimer();
    };

    useEffect(() => {
        if (syncGameStatus === 'playing') gameStateTimer();
    }, [considerationTime]);

    useEffect(() => {
        if (gameState.currentPlayer !== null && syncGameStatus === 'playing') {
            // if current player is not user, request for API player
            if (gameState.currentPlayer !== mainPlayerId) {
                requestApiPlay();
            } else {
                setPredictionRes({ prediction: [], hands: [] });
            }
        }
    }, [gameState.currentPlayer]);

    useEffect(() => {
        if (gameStatus === 'playing') startGame();
    }, [gameStatus]);

    // tell the backend that this player has opened the page: it knows the player by the ID kept in this browser
    // (a new one is made on the first visit), and sends the nickname and the saved scores
    const applyPlayerData = (data) => {
        playerNames = data.names;
        // the game may already have started (auto start): put the names on the players now
        playerInfo.forEach((info, i) => {
            info.agentInfo = { ...(info.agentInfo || {}), name: playerNames[i] };
        });
        setScoreData(data);
    };
    useEffect(() => {
        let storedId = '';
        try {
            storedId = localStorage.getItem(PLAYER_ID_KEY) || '';
        } catch (e) {}
        axios
            .post(`${douzeroDemoUrl}/player/init`, { id: storedId })
            .then((res) => {
                myPlayerId = res.data.id;
                try {
                    localStorage.setItem(PLAYER_ID_KEY, myPlayerId);
                } catch (e) {}
                applyPlayerData(res.data);
                // the first visit: the player has to choose a nickname before playing
                if (!res.data.nickname) {
                    setNickAnchor(tableCenter());
                    setNicknameInput('');
                    setNicknameDialog({ open: true, required: true });
                }
            })
            .catch(() => {});
    }, []);

    // the nickname windows are centred on the table (on the same vertical axis as the line "底分 xx")
    const tableCenter = () => {
        const table = document.querySelector('.doudizhu-gameboard-paper');
        if (!table) return null;
        const rect = table.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };

    const openNicknameDialog = () => {
        setNickAnchor(tableCenter());
        setNicknameInput(playerNames[mainPlayerId] || '');
        setNicknameDialog({ open: true, required: false });
    };

    const submitNickname = () => {
        const nickname = nicknameInput.trim();
        if (!nickname) return;
        axios
            .post(`${douzeroDemoUrl}/player/nickname`, { id: myPlayerId, nickname })
            .then((res) => {
                applyPlayerData(res.data);
                setNicknameDialog({ open: false, required: false });
            })
            .catch(() =>
                Message({ message: t('doudizhu.msg_network_error'), type: 'error', showClose: true }),
            );
    };

    const clearScore = () => {
        setIsClearScoreDialogOpen(false);
        axios
            .post(`${douzeroDemoUrl}/score/reset`, { id: myPlayerId })
            .then((res) => applyPlayerData(res.data))
            .catch(() =>
                Message({ message: t('doudizhu.msg_network_error'), type: 'error', showClose: true }),
            );
    };

    // scale the whole table to the window, and keep track of fullscreen mode
    useEffect(() => {
        const updateScale = () => {
            const fullscreen = !!document.fullscreenElement;
            setIsFullscreen(fullscreen);
            document.body.classList.toggle('dz-fullscreen', fullscreen);
            const availableHeight = window.innerHeight - (fullscreen ? 0 : 80);
            const next = Math.min(window.innerWidth / 1412, availableHeight / 690);
            // scale by the available height (and by the width when the window is narrow); when the window is wider
            // than that, the table is made wider instead of leaving empty space on the sides
            setViewScale(Math.max(0.6, Math.min(2.5, next)));
            setViewWidth(window.innerWidth);
        };
        updateScale();
        window.addEventListener('resize', updateScale);
        document.addEventListener('fullscreenchange', updateScale);
        return () => {
            window.removeEventListener('resize', updateScale);
            document.removeEventListener('fullscreenchange', updateScale);
            document.body.classList.remove('dz-fullscreen');
        };
    }, []);

    const toggleFullscreen = () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen();
    };

    // start the next game (bidding) as soon as the table is ready, without clicking "开始游戏"
    useEffect(() => {
        if (gameStatus === 'ready' && getSetting('autoStart', true)) startBidding();
    }, [gameStatus]);

    // AI players bid when it is their turn
    useEffect(() => {
        if (
            gameStatus !== 'bidding' ||
            bidState.finished ||
            bidState.current === null ||
            bidState.current === mainPlayerId
        )
            return undefined;
        const player = bidState.current;
        const handle = setTimeout(() => {
            setBidState(applyBid(bidState, player, aiBid(initHands[player], bidState.highest)));
        }, Math.min(apiPlayDelay, 2000));
        return () => clearTimeout(handle);
    }, [gameStatus, bidState, apiPlayDelay]);

    // bidding is over: pause briefly so that the result is visible, then start the game (or redeal)
    useEffect(() => {
        if (gameStatus !== 'bidding' || !bidState.finished) return undefined;
        const handle = setTimeout(() => {
            if (bidState.highestBidder < 0) redealAndBid();
            else {
                finalBid = { landlordIdx: bidState.highestBidder, points: bidState.highest };
                handleSelectRole(landlordIdxToRole[bidState.highestBidder]);
            }
        }, getSetting('bidResultDelayMs', 100));
        return () => clearTimeout(handle);
    }, [gameStatus, bidState]);

    const handleMainPlayerAct = (type) => {
        switch (type) {
            case 'play': {
                // check if cards to play is in legal action list
                if (gameState.turn === legalActions.turn) {
                    if (isLegalSelection(selectedCards)) {
                        // the play is accepted: the list of this turn is used up, so that the button is really disabled
                        // at once (a second click on it must not do anything) until the next turn of the user
                        legalActions = { turn: -1, actions: [] };
                        setLegalVersion((v) => v + 1);
                        proceedNextTurn(selectedCards, false);
                    } else {
                        Message({
                            message: t('doudizhu.msg_illegal_play'),
                            type: 'warning',
                            showClose: true,
                        });
                        setSelectedCards([]);
                    }
                } else {
                    Message({
                        message: t('doudizhu.msg_network_error'),
                        type: 'error',
                        showClose: true,
                    });
                }
                break;
            }
            case 'pass': {
                proceedNextTurn([], false);
                setSelectedCards([]);
                break;
            }
            case 'deselect': {
                setSelectedCards([]);
                break;
            }
            case 'hint': {
                if (gameState.turn === legalActions.turn) {
                    const turn = legalActions.turn;
                    const token = gameToken;
                    const hand = gameState.hands[gameState.currentPlayer];
                    // select the cards of an action (a string of ranks) in your hand
                    const selectAction = (action) => {
                        const ranks = action.split('');
                        const cards = [];
                        hand.forEach((card) => {
                            const { rank } = card2SuiteAndRank(card);
                            const idx = ranks.indexOf(rank);
                            if (idx >= 0) {
                                ranks.splice(idx, 1);
                                cards.push(card);
                            }
                        });
                        setSelectedCards(cards);
                    };
                    // the old behaviour, used when the backend cannot answer: the legal actions one after another
                    const cycleHint = () => {
                        hintIdx++;
                        if (hintIdx >= legalActions.actions.length) hintIdx = 0;
                        selectAction(legalActions.actions[hintIdx]);
                    };
                    const showBest = (action) => {
                        if (action === '') {
                            setSelectedCards([]);
                            Message({ message: t('doudizhu.hint_pass'), type: 'info', showClose: true });
                        } else {
                            selectAction(action);
                        }
                    };
                    setSelectedCards([]);
                    if (hintBest.turn === turn && hintBest.token === token) {
                        // asked before in this turn: the same answer, no new request
                        showBest(hintBest.action);
                    } else if (legalActions.actions.length === 1) {
                        showBest(legalActions.actions[0]);
                    } else {
                        // ask the model, like the AI players do: the hint is the action with the best win rate
                        axios
                            .post(`${douzeroDemoUrl}/predict`, qs.stringify(buildPredictBody()))
                            .then((apiRes) => {
                                if (token !== gameToken || turn !== legalActions.turn) return;
                                const result = apiRes.data && apiRes.data.status === 0 ? apiRes.data.result : null;
                                const keys = result ? Object.keys(result) : [];
                                if (keys.length === 0) {
                                    cycleHint();
                                    return;
                                }
                                let best = keys[0];
                                keys.forEach((k) => {
                                    if (Number(result[k]) > Number(result[best])) best = k;
                                });
                                hintBest = { turn, token, action: best };
                                showBest(best);
                            })
                            .catch(() => {
                                if (token === gameToken && turn === legalActions.turn) cycleHint();
                            });
                    }
                } else {
                    Message({
                        message: t('doudizhu.msg_network_error'),
                        type: 'error',
                        showClose: true,
                    });
                }
                break;
            }
        }
    };

    // keyboard shortcuts. The keys are read from public/hotkeys.js (window.DOUDIZHU_HOTKEYS), which can be edited
    // without rebuilding the page.
    //   play key:  plays the selected cards (same as the 出牌 button), no effect otherwise
    //   pass key:  nothing selected -> pass (same as the 不出 button); something selected -> clear the selection;
    //              during the bidding it means 不叫
    useEffect(() => {
        const onKeyDown = (e) => {
            if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
            const target = e.target;
            if (
                target &&
                (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
                    target.isContentEditable ||
                    (target.getAttribute && target.getAttribute('role') === 'slider'))
            )
                return;
            const keys = window.DOUDIZHU_HOTKEYS || {};
            const matches = (list, fallback) =>
                (Array.isArray(list) ? list : fallback).some((k) => String(k).toLowerCase() === e.key.toLowerCase());
            const isPlayKey = matches(keys.play, [' ']);
            const isPassKey = matches(keys.passOrDeselect, ['d']);
            if (!isPlayKey && !isPassKey) return;

            // during the bidding: the pass key means 不叫
            if (
                isPassKey &&
                gameStatus === 'bidding' &&
                !bidState.finished &&
                bidState.current === mainPlayerId
            ) {
                e.preventDefault();
                handleBid(0);
                return;
            }

            // only while it is the user's turn in a running game, and the legal actions of this turn have arrived
            const myTurn =
                gameStatus === 'playing' &&
                !isGameEndDialogOpen &&
                gameState.currentPlayer === mainPlayerId &&
                gameState.turn === legalActions.turn;
            if (!myTurn) return;

            if (isPlayKey) {
                // a focused button would also be "clicked" by the space key: take the focus away from it
                if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
                e.preventDefault();
                // the play key does nothing while the play button is grey
                if (isLegalSelection(selectedCards)) handleMainPlayerAct('play');
            } else if (isPassKey) {
                e.preventDefault();
                if (selectedCards.length > 0) handleMainPlayerAct('deselect');
                else if (!isPassDisabled) handleMainPlayerAct('pass');
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    });

    const computePredictionCards = (cards, hands) => {
        let computedCards = [];
        if (cards.length > 0) {
            hands.forEach((card) => {
                const { rank } = card2SuiteAndRank(card);
                const idx = cards.indexOf(rank);
                if (idx >= 0) {
                    cards.splice(idx, 1);
                    computedCards.push(card);
                }
            });
        } else {
            computedCards = 'pass';
        }

        if (computedCards === 'pass') {
            return (
                <div className={'non-card ' + toggleFade}>
                    <span>{t('doudizhu.pass')}</span>
                </div>
            );
        } else {
            return (
                <div className={'unselectable playingCards loose ' + toggleFade}>
                    <ul className="hand" style={{ width: computeHandCardsWidth(computedCards.length, 10) }}>
                        {computedCards.map((card) => {
                            const [rankClass, suitClass, rankText, suitText] = translateCardData(card);
                            return (
                                <li key={`handCard-${card}`}>
                                    <label className={`card ${rankClass} ${suitClass}`} href="/#">
                                        <span className="rank">{rankText}</span>
                                        <span className="suit">{suitText}</span>
                                    </label>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            );
        }
    };

    // Card counter: how many cards of each rank are still unseen, i.e. neither in the user's hand nor played yet.
    // Only public information is used (the user's own hand and the cards played so far).
    const COUNTER_RANKS = [
        { key: 'D', label: t('doudizhu.counter_big_joker'), max: 1 },
        { key: 'X', label: t('doudizhu.counter_small_joker'), max: 1 },
        ...['2', 'A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3'].map((r) => ({
            key: r,
            label: r === 'T' ? '10' : r,
            max: 4,
        })),
    ];

    const computeCardCounter = () => {
        const isZh = (i18n.language || '').startsWith('zh');
        const remaining = {};
        COUNTER_RANKS.forEach((r) => (remaining[r.key] = r.max));
        const take = (card) => {
            const rank = card === 'RJ' ? 'D' : card === 'BJ' ? 'X' : card.charAt(1);
            if (remaining[rank] > 0) remaining[rank]--;
        };
        gameState.hands[mainPlayerId].forEach(take);
        gameHistory.forEach((record) => record.forEach(take));

        return (
            <div className="card-counter">
                <div className="card-counter-title doudizhu-panel-title">{t('doudizhu.card_counter')}</div>
                {COUNTER_RANKS.map((r) => (
                    <div key={'counter-' + r.key} className={'card-counter-row' + (remaining[r.key] === 0 ? ' empty' : '')}>
                        <span
                            className={'card-counter-label' + (r.key === 'D' && !isZh ? ' big-joker' : '')}
                        >
                            {r.label}
                        </span>
                        <span className="card-counter-pips">
                            {Array.from({ length: r.max }).map((_, i) => (
                                <span key={i} className={'pip' + (i < remaining[r.key] ? ' on' : '')} />
                            ))}
                        </span>
                        <span className="card-counter-number">{remaining[r.key]}</span>
                    </div>
                ))}
            </div>
        );
    };

    const computeProbabilityItem = (idx) => {
        if (gameStatus !== 'ready') {
            if (hidePredictionArea) {
                return (
                    <div className={'playing'}>
                        <div className={'non-card'}>
                            <span>{t('hidden')}</span>
                        </div>
                    </div>
                );
            }
            return (
                <div className={'playing'}>
                    <div className="probability-move">
                        {predictionRes.prediction.length > idx ? (
                            computePredictionCards(predictionRes.prediction[idx][0].split(''), predictionRes.hands)
                        ) : (
                            <NotInterestedIcon fontSize="large" />
                        )}
                    </div>
                    {predictionRes.prediction.length > idx ? (
                        <div className={'non-card'} style={{ marginTop: '0px' }}>
                            <span>{`${t('doudizhu.expected_win_rate')}: ${(
                                Number(predictionRes.prediction[idx][1]) * 100
                            ).toFixed(2)}%`}</span>
                        </div>
                    ) : (
                        ''
                    )}
                </div>
            );
        } else {
            return <span className={'waiting'}>{t('waiting...')}</span>;
        }
    };

    const gameSpeedMarks = [
        {
            value: 0,
            label: '0s',
        },
        {
            value: 1,
            label: '1s',
        },
        {
            value: 2,
            label: '3s',
        },
        {
            value: 3,
            label: '5s',
        },
        {
            value: 4,
            label: '10s',
        },
        {
            value: 5,
            label: '30s',
        },
    ];

    const gameSpeedMap = [
        {
            value: 0,
            delay: 0,
        },
        {
            value: 1,
            delay: 1000,
        },
        {
            value: 2,
            delay: 3000,
        },
        {
            value: 3,
            delay: 5000,
        },
        {
            value: 4,
            delay: 10000,
        },
        {
            value: 5,
            delay: 30000,
        },
    ];

    const changeApiPlayerDelay = (newVal) => {
        const found = gameSpeedMap.find((element) => element.value === newVal);
        if (found) setApiPlayDelay(found.delay);
    };

    const sliderValueText = (value) => {
        return value;
    };

    const handleLocaleChange = useCallback((newLocale) => {
        i18n.changeLanguage(newLocale);
        setLocale(newLocale);
        localStorage.setItem('LOCALE', newLocale);
    }, []);

    return (
        <div>
            <Dialog
                disableBackdropClick
                disableEscapeKeyDown
                BackdropProps={{ style: { backgroundColor: 'rgba(0, 0, 0, 0.15)' } }}
                PaperProps={
                    dialogAnchor
                        ? {
                              style: {
                                  position: 'absolute',
                                  left: dialogAnchor.x,
                                  top: dialogAnchor.y,
                                  margin: 0,
                                  transform: 'translateX(-50%)',
                                  maxHeight: '96vh',
                              },
                          }
                        : undefined
                }
                open={isGameEndDialogOpen}
                onClose={handleCloseGameEndDialog}
                aria-labelledby="alert-dialog-title"
                aria-describedby="alert-dialog-description"
            >
                <DialogTitle id="alert-dialog-title" style={{ padding: '12px 24px 0', textAlign: 'center' }}>
                    {gameEndDialogTitle}
                </DialogTitle>
                <DialogContent>
                    {settlement && (
                        <div className="doudizhu-score-summary">
                            {!settlement.concede && (<div style={{ marginBottom: '8px', fontSize: '14px' }}>
                                {t('doudizhu.base_score')}{/[\u4e00-\u9fff]$/.test(t('doudizhu.base_score')) ? '' : ' '}{settlement.base} × {t('doudizhu.multiplier')}{/[\u4e00-\u9fff]$/.test(t('doudizhu.multiplier')) ? '' : ' '}{settlement.multiplier}
                                {(() => {
                                    // every reason for a doubling, joined with +, in one pair of brackets
                                    const reasons = [];
                                    if (settlement.bombCount > 0) reasons.push(t('doudizhu.bombs_n', { n: settlement.bombCount }));
                                    if (settlement.spring) reasons.push(t('doudizhu.spring'));
                                    if (settlement.antiSpring) reasons.push(t('doudizhu.anti_spring'));
                                    return reasons.length > 0
                                        ? `${t('doudizhu.remark_open')}${reasons.join(' + ')}${t('doudizhu.remark_close')}`
                                        : '';
                                })()}
                            </div>)}
                            <TableContainer component={Paper} style={{ marginBottom: '4px' }}>
                                <Table size="small" aria-label="score table">
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>ID</TableCell>
                                            <TableCell>{t('doudizhu.this_game')}</TableCell>
                                            <TableCell>{t('doudizhu.total_score')}</TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {[0, 1, 2].map((i) => (
                                            <TableRow key={'score-row-' + i}>
                                                <TableCell component="th" scope="row">
                                                    {playerNames[i]}
                                                    {i === settlement.landlordIdx ? ' ★' : ''}
                                                </TableCell>
                                                <TableCell>
                                                    {settlement.deltas[i] > 0 ? '+' : ''}
                                                    {settlement.deltas[i]}
                                                </TableCell>
                                                <TableCell>
                                                    {scoreData && scoreData.scores ? scoreData.scores[i] : '-'}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                            <div className="deal-id">{dealId}</div>
                        </div>
                    )}
                </DialogContent>
                <DialogActions style={{ justifyContent: 'center', padding: '2px 8px 2px' }}>
                    <Button
                        onClick={() => handleCloseGameEndDialog()}
                        color="primary"
                        variant="contained"
                        autoFocus
                        style={{ margin: '4px 16px 16px 16px' }}
                    >
                        {t('play_again')}
                    </Button>
                </DialogActions>
            </Dialog>
            <Dialog
                open={nicknameDialog.open}
                disableBackdropClick={nicknameDialog.required}
                disableEscapeKeyDown={nicknameDialog.required}
                onClose={() => setNicknameDialog({ open: false, required: false })}
                aria-labelledby="nickname-dialog-title"
                PaperProps={
                    nickAnchor
                        ? {
                              style: {
                                  position: 'absolute',
                                  left: nickAnchor.x,
                                  top: nickAnchor.y,
                                  margin: 0,
                                  transform: 'translate(-50%, -50%)',
                              },
                          }
                        : undefined
                }
            >
                <DialogTitle id="nickname-dialog-title">
                    {nicknameDialog.required ? t('doudizhu.nickname_title') : t('doudizhu.change_nickname')}
                </DialogTitle>
                <DialogContent>
                    <TextField
                        autoFocus
                        fullWidth
                        value={nicknameInput}
                        placeholder={t('doudizhu.nickname_hint', { n: NICKNAME_MAX })}
                        inputProps={{ maxLength: NICKNAME_MAX }}
                        onChange={(e) => setNicknameInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') submitNickname();
                        }}
                    />
                </DialogContent>
                <DialogActions style={{ padding: '8px 24px 16px' }}>
                    {!nicknameDialog.required && (
                        <Button onClick={() => setNicknameDialog({ open: false, required: false })}>
                            {t('doudizhu.cancel')}
                        </Button>
                    )}
                    <Button
                        onClick={submitNickname}
                        color="primary"
                        variant="contained"
                        disabled={!nicknameInput.trim()}
                    >
                        {t('doudizhu.ok')}
                    </Button>
                </DialogActions>
            </Dialog>
            <Dialog
                open={isClearScoreDialogOpen}
                onClose={() => setIsClearScoreDialogOpen(false)}
                PaperProps={
                    nickAnchor
                        ? {
                              style: {
                                  position: 'absolute',
                                  left: nickAnchor.x,
                                  top: nickAnchor.y,
                                  margin: 0,
                                  transform: 'translate(-50%, -50%)',
                              },
                          }
                        : undefined
                }
            >
                <DialogTitle>{t('doudizhu.clear_score_title')}</DialogTitle>
                <DialogContent>{t('doudizhu.clear_score_text')}</DialogContent>
                <DialogActions style={{ padding: '8px 24px 16px' }}>
                    <Button onClick={() => setIsClearScoreDialogOpen(false)}>{t('doudizhu.cancel')}</Button>
                    <Button onClick={clearScore} color="primary" variant="contained">
                        {t('doudizhu.clear_score_ok')}
                    </Button>
                </DialogActions>
            </Dialog>
            {/* the header is hidden in fullscreen mode, so the way out is this semi-transparent button (Esc also works on a computer) */}
            {isFullscreen && (
                <Button className="exit-fullscreen-button" size="small" variant="outlined" onClick={toggleFullscreen}>
                    {t('doudizhu.exit_fullscreen')}
                </Button>
            )}
            <div className={'doudizhu-view-container'} style={{ zoom: viewScale, width: Math.max(1400, Math.floor(viewWidth / viewScale) - 12) + 'px' }}>
                <Layout.Row style={{ height: '582px', marginTop: '5px' }}>
                    <Layout.Col style={{ height: '100%', width: '80.5%' }} span="17">
                        <div style={{ height: '100%', position: 'relative' }}>
                            {(gameStatus === 'playing' || gameStatus === 'over') && finalBid.landlordIdx >= 0 && (
                                <div className="doudizhu-base-multiplier">
                                    <div>{`${t('doudizhu.base_score')} ${finalBid.points}`}</div>
                                    <div>{`${t('doudizhu.multiplier')} ${currentMultiplier(bombNum)}`}</div>
                                </div>
                            )}
                            <Paper className={'doudizhu-gameboard-paper'} elevation={3}>
                                <DoudizhuGameBoard
                                    showCardBack={(gameStatus === 'playing' || gameStatus === 'bidding') && hideRivalHand}
                                    handleSelectRole={handleSelectRole}
                                    handleStartBidding={startBidding}
                                    handleBid={handleBid}
                                    handleConcede={handleConcede}
                                    handleChangeNickname={openNicknameDialog}
                                    scores={scoreData && scoreData.scores ? scoreData.scores : null}
                                    bidState={bidState}
                                    isPassDisabled={isPassDisabled}
                                    isHintDisabled={isHintDisabled}
                                    isPlayDisabled={
                                        gameStatus !== 'playing' ||
                                        gameState.currentPlayer !== mainPlayerId ||
                                        gameState.turn !== legalActions.turn
                                    }
                                    isPlayValid={isLegalSelection(selectedCards)}
                                    gamePlayable={true}
                                    playerInfo={playerInfo}
                                    hands={gameState.hands}
                                    selectedCards={selectedCards}
                                    handleSelectedCards={handleSelectedCards}
                                    latestAction={gameState.latestAction}
                                    mainPlayerId={mainPlayerId}
                                    currentPlayer={gameState.currentPlayer}
                                    considerationTime={considerationTime}
                                    turn={gameState.turn}
                                    toggleFade={toggleFade}
                                    gameStatus={gameStatus}
                                    handleMainPlayerAct={handleMainPlayerAct}
                                    handleLocaleChange={(newLocale) => {
                                        handleLocaleChange(newLocale);
                                        setGameStatus('ready');
                                    }}
                                />
                            </Paper>
                        </div>
                    </Layout.Col>
                    <Layout.Col span="7" style={{ height: '100%', width: '19.5%' }}>
                        <Paper className={'doudizhu-probability-paper'} elevation={3}>
                            {playerInfo.length > 0 && gameState.currentPlayer !== null ? (
                                <div style={{ padding: '16px' }}>
                                    <span className="doudizhu-panel-title" style={{ marginBottom: '8px' }}>
                                        {t('doudizhu.three_landlord_cards')}
                                    </span>
                                    <div className="playingCards" style={{ display: 'flex', justifyContent: 'center' }}>
                                        {sortDoudizhuCards(originalThreeLandlordCards, true).map((card) => {
                                            const [rankClass, suitClass, rankText, suitText] = translateCardData(card);
                                            return (
                                                <div
                                                    key={'probability-cards-' + rankText + '-' + suitText}
                                                    style={{ fontSize: '1.2em' }}
                                                    className={`card ${rankClass} full-content ${suitClass}`}
                                                >
                                                    <span className="rank">{rankText}</span>
                                                    <span className="suit">{suitText}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <div
                                    style={{
                                        height: '112px',
                                        padding: '16px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <span>{t('waiting...')}</span>
                                </div>
                            )}
                            <Divider />
                            {hidePredictionArea ? (
                                gameState.currentPlayer !== null && (gameStatus === 'playing' || gameStatus === 'over') ? (
                                    computeCardCounter()
                                ) : (
                                    <div style={{ padding: '16px', textAlign: 'center' }}>{t('waiting...')}</div>
                                )
                            ) : (
                                <>
                            <div className={'probability-player'} style={{ height: '19px', textAlign: 'center' }}>
                                {playerInfo.length > 0 && gameState.currentPlayer !== null ? (
                                    <span>
                                        {t(
                                            `doudizhu.${
                                                ['landlord', 'landlord_down', 'landlord_up'][
                                                    playerInfo[gameState.currentPlayer].douzeroPlayerPosition
                                                ]
                                            }`,
                                        )}
                                    </span>
                                ) : (
                                    <span>{t('waiting...')}</span>
                                )}
                            </div>
                            <Divider />
                            <div className={'probability-table with-three-landlord-cards'}>
                                <div className={'probability-item'}>{computeProbabilityItem(0)}</div>
                                <div className={'probability-item'}>{computeProbabilityItem(1)}</div>
                                <div className={'probability-item'}>{computeProbabilityItem(2)}</div>
                            </div>
                                </>
                            )}
                        </Paper>
                    </Layout.Col>
                </Layout.Row>
                <div className="game-controller">
                    <Paper className={'game-controller-paper'} elevation={3}>
                        <Layout.Row style={{ height: '51px' }}>
                            <Layout.Col span="6" style={{ height: '51px', lineHeight: '48px' }}>
                                <div style={{ textAlign: 'center' }}>
                                    <Button
                                        className="reset-score-button"
                                        size="small"
                                        variant="outlined"
                                        onClick={() => {
                                            setNickAnchor(tableCenter());
                                            setIsClearScoreDialogOpen(true);
                                        }}
                                    >
                                        {t('doudizhu.clear_score')}
                                    </Button>
                                </div>
                            </Layout.Col>
                            <Layout.Col span="1" style={{ height: '100%', width: '1px' }}>
                                <Divider orientation="vertical" />
                            </Layout.Col>
                            <Layout.Col
                                span="3"
                                style={{ height: '51px', lineHeight: '51px', marginLeft: '-2px', marginRight: '-2px' }}
                            >
                                <div style={{ textAlign: 'center' }}>{`${t('turn')} ${gameState.turn}`}</div>
                            </Layout.Col>
                            <Layout.Col span="1" style={{ height: '100%', width: '1px' }}>
                                <Divider orientation="vertical" />
                            </Layout.Col>
                            <Layout.Col span="12">
                                <div>
                                    <label
                                        className={'form-label-left'}
                                        style={{ width: '155px', lineHeight: '28px', fontSize: '15px' }}
                                    >
                                        {t('doudizhu.ai_thinking_time')}
                                    </label>
                                    <div style={{ marginLeft: '160px', marginRight: '30px' }}>
                                        <Slider
                                            value={gameSpeedMap.find((element) => element.delay === apiPlayDelay).value}
                                            getAriaValueText={sliderValueText}
                                            onChange={(e, newVal) => {
                                                changeApiPlayerDelay(newVal);
                                            }}
                                            aria-labelledby="discrete-slider-custom"
                                            step={1}
                                            min={0}
                                            max={5}
                                            track={false}
                                            valueLabelDisplay="off"
                                            marks={gameSpeedMarks}
                                        />
                                    </div>
                                </div>
                            </Layout.Col>
                            <Layout.Col span="1" style={{ height: '100%', width: '1px' }}>
                                <Divider orientation="vertical" />
                            </Layout.Col>
                            <Layout.Col span="3" style={{ height: '100%' }}>
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'center',
                                        alignItems: 'center',
                                        height: '100%',
                                        paddingLeft: '10px',
                                    }}
                                >
                                    <TranslateIcon style={{ width: '1.2rem', height: '1.2rem' }} />
                                    <Select
                                        id="language-select"
                                        style={{ width: '100%', textAlign: 'center', marginLeft: '7px' }}
                                        value={locale}
                                        onChange={(e) => handleLocaleChange(e.target.value)}
                                    >
                                        <MenuItem value={'zh'}>中文</MenuItem>
                                        <MenuItem value={'en'}>English</MenuItem>
                                    </Select>
                                </div>
                            </Layout.Col>
                        </Layout.Row>
                    </Paper>
                </div>
            </div>
        </div>
    );
}

export default PvEDoudizhuDemoView;
