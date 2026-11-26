import Avatar from '@material-ui/core/Avatar';
import Button from '@material-ui/core/Button';
import Chip from '@material-ui/core/Chip';
import { Layout } from 'element-react';
import React from 'react';
import { withTranslation } from 'react-i18next';
import '../../assets/doudizhu.scss';
import Landlord_wName from '../../assets/images/Portrait/Landlord_wName.png';
import Peasant_wName from '../../assets/images/Portrait/Peasant_wName.png';
import PlaceHolderPlayer from '../../assets/images/Portrait/Player.png';
import { millisecond2Second, sortDoudizhuCards, translateCardData } from '../../utils';

// The portraits are loaded when the page is opened and kept in memory: after a long idle time (the tab was left open
// overnight, say) the browser throws away pictures that no element uses, and the landlord's portrait then came late.
// Holding these Image objects keeps them in the browser's cache.
const portraitPreload = [Landlord_wName, Peasant_wName, PlaceHolderPlayer].map((src) => {
    const img = new Image();
    img.src = src;
    if (img.decode) img.decode().catch(() => {});
    return img;
});

// The golden ring and the pop of the landlord's portrait start when the picture is there (see doudizhu.scss).
const markLoaded = (el) => {
    if (el && el.parentNode && el.complete && el.naturalWidth > 0) el.parentNode.classList.add('loaded');
};

// The hourglass is a glass with gold caps, with sand in it. When it turns over, the sand has to look right again at the end
// of the turn, so there are two layers of sand: one for the upright glass (hg-sand-a) and one drawn upside down (hg-sand-b);
// they are exchanged when the turn has reached 170 degrees (see the keyframes in doudizhu.scss), and the highlights are placed
// symmetrically (the caps have their light in the middle too), so that the glass at 180 degrees looks exactly like the glass
// at 0 degrees and the loop has no jump.
// Every hourglass gets its own ids (there can be two of them on the table at the same time). It only shows that the game
// is running, and it turns over every few seconds (public/custom.css: --dz-hourglass-period). It is shown where the stopwatch
// used to be.
let hourglassCounter = 0;
const GLASS_PATH =
    'M6 7 H34 V13 C34 22 24 25 22.5 28 C24 31 34 34 34 43 V49 H6 V43 C6 34 16 31 17.5 28 C16 25 6 22 6 13 Z';
const GLASS_INNER =
    'M7.2 8.2 H32.8 V13 C32.8 21.6 23.2 24.4 21.6 28 C23.2 31.6 32.8 34.4 32.8 43 V47.8 H7.2 V43 C7.2 34.4 16.8 31.6 18.4 28 C16.8 24.4 7.2 21.6 7.2 13 Z';
const Hourglass = () => {
    const [n] = React.useState(() => ++hourglassCounter);
    const sand = (
        <>
            <path d="M6 16.5 Q20 22.5 34 16.5 V30 H6 Z" fill={`url(#hg-sand-${n})`} />
            <path d="M6 49 V45.5 Q17 44.5 20 38.5 Q23 44.5 34 45.5 V49 Z" fill={`url(#hg-sand-${n})`} />
            <rect x="19.5" y="26" width="1" height="13" fill="#f1c45a" />
        </>
    );
    return (
        <svg className="hourglass" viewBox="0 0 40 56" width="40" height="56" aria-hidden="true">
            <defs>
                <clipPath id={`hg-inner-${n}`}>
                    <path d={GLASS_INNER} />
                </clipPath>
                <linearGradient id={`hg-sand-${n}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#ffe9a6" />
                    <stop offset=".55" stopColor="#f1c45a" />
                    <stop offset="1" stopColor="#d49a2f" />
                </linearGradient>
                <linearGradient id={`hg-cap-${n}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#a47d34" />
                    <stop offset=".5" stopColor="#f6dc9a" />
                    <stop offset="1" stopColor="#a47d34" />
                </linearGradient>
                <radialGradient id={`hg-glass-${n}`} cx=".5" cy=".5" r=".6">
                    <stop offset="0" stopColor="#fff" stopOpacity=".1" />
                    <stop offset="1" stopColor="#fff" stopOpacity=".3" />
                </radialGradient>
            </defs>
            <path d={GLASS_PATH} fill={`url(#hg-glass-${n})`} />
            <g className="hg-sand-a" clipPath={`url(#hg-inner-${n})`}>
                {sand}
            </g>
            <g className="hg-sand-b" clipPath={`url(#hg-inner-${n})`}>
                <g transform="rotate(180 20 28)">{sand}</g>
            </g>
            <path
                d={GLASS_PATH}
                fill="none"
                stroke="#e9f6f2"
                strokeOpacity=".75"
                strokeWidth="1.2"
                strokeLinejoin="round"
            />
            <path
                d="M9.2 10.5 V13.2 C9.2 16 11 18.2 13.4 20"
                fill="none"
                stroke="#fff"
                strokeOpacity=".85"
                strokeWidth="1.6"
                strokeLinecap="round"
            />
            <path
                d="M30.8 45.5 V42.8 C30.8 40 29 37.8 26.6 36"
                fill="none"
                stroke="#fff"
                strokeOpacity=".85"
                strokeWidth="1.6"
                strokeLinecap="round"
            />
            <rect x="2" y="2" width="36" height="6" rx="2.5" fill={`url(#hg-cap-${n})`} stroke="#7d5c22" strokeWidth=".8" />
            <rect x="3.5" y="4.4" width="33" height="1.2" rx=".6" fill="#fff" fillOpacity=".5" />
            <rect x="2" y="48" width="36" height="6" rx="2.5" fill={`url(#hg-cap-${n})`} stroke="#7d5c22" strokeWidth=".8" />
            <rect x="3.5" y="50.4" width="33" height="1.2" rx=".6" fill="#fff" fillOpacity=".5" />
        </svg>
    );
};

class DoudizhuGameBoard extends React.Component {
    constructor(props) {
        super(props);

        this.isSelectingCards = false;
        this.selectingCards = { start: null, cards: [] };
        this.state = {
            highlightedCards: [],
        };
    }

    computePlayerPortrait(playerId, playerIdx) {
        if (this.props.playerInfo.length > 0) {
            const chipTitle =
                this.props.playerInfo[playerIdx].agentInfo && this.props.playerInfo[playerIdx].agentInfo.name
                    ? ''
                    : 'ID';
            const chipLabel =
                this.props.playerInfo[playerIdx].agentInfo && this.props.playerInfo[playerIdx].agentInfo.name
                    ? this.props.playerInfo[playerIdx].agentInfo.name
                    : this.props.handleChangeNickname
                    ? '' // single-player table: nothing is shown until the nickname is known (not the seat number)
                    : playerId;
            const isLandlord = this.props.playerInfo[playerIdx].role === 'landlord';
            // before the bidding is over nobody has a role yet: the neutral portrait is shown
            const roleKnown = this.props.gameStatus === 'playing' || this.props.gameStatus === 'over';
            const portrait = !roleKnown ? (
                <img src={PlaceHolderPlayer} alt={'Player'} height="70%" width="70%" />
            ) : isLandlord ? (
                <span className="landlord-wrap">
                    <img
                        src={Landlord_wName}
                        alt={'Landlord'}
                        ref={markLoaded}
                        onLoad={(e) => markLoaded(e.target)}
                    />
                </span>
            ) : (
                <img src={Peasant_wName} alt={'Peasant'} height="70%" width="70%" />
            );
            if (this.props.handleChangeNickname) {
                // the table of the single-player game: the names are plain text (no blue chip). Your own name is above
                // the portrait and the button to change it is where the name of the AI players is.
                const t = this.props.t;
                const isYou = playerIdx === this.props.mainPlayerId;
                const sc = this.props.scores && chipLabel ? this.props.scores[playerIdx] : null;
                const nick = <div className="player-nick">{chipLabel}</div>;
                const score = <div className="player-score">{sc === null || sc === undefined ? '' : sc}</div>;
                return isYou ? (
                    <div className="player-info-you">
                        <Button
                            className="change-nickname-button"
                            size="small"
                            variant="outlined"
                            onClick={(e) => {
                                e.stopPropagation();
                                this.props.handleChangeNickname();
                            }}
                        >
                            {t('doudizhu.change_nickname')}
                        </Button>
                        {portrait}
                        {nick}
                        {score}
                    </div>
                ) : (
                    <div>
                        {portrait}
                        {nick}
                        {score}
                    </div>
                );
            }
            return (
                <div>
                    {portrait}
                    <Chip
                        style={{ maxWidth: '135px' }}
                        avatar={chipTitle ? <Avatar>{chipTitle}</Avatar> : undefined}
                        label={chipLabel}
                        color="primary"
                    />
                </div>
            );
        } else
            return (
                <div>
                    <img src={PlaceHolderPlayer} alt={'Player'} height="70%" width="70%" />
                    <Chip avatar={<Avatar>ID</Avatar>} label={playerId} color="primary" />
                </div>
            );
    }

    handleContainerMouseLeave() {
        if (!this.props.gamePlayable) return;
        if (this.isSelectingCards) {
            this.isSelectingCards = false;
            this.selectingCards = { start: null, cards: [] };
            this.setState({ highlightedCards: [] });
        }
    }

    handleContainerMouseUp() {
        if (!this.props.gamePlayable) return;
        if (this.isSelectingCards) {
            this.isSelectingCards = false;
            this.props.handleSelectedCards(this.selectingCards.cards);
            this.selectingCards = { start: null, cards: [] };
            this.setState({ highlightedCards: [] });
        } else {
            this.props.handleMainPlayerAct('deselect');
        }
    }

    handleCardMouseDown(card, idx) {
        this.isSelectingCards = true;
        this.selectingCards.start = idx;
        this.selectingCards.cards = [card];
        this.setState({ highlightedCards: this.selectingCards.cards });
    }

    handleCardMouseOver(allCards, card, idx) {
        if (this.isSelectingCards) {
            let tmpCards;
            if (idx > this.selectingCards.start) {
                tmpCards = allCards.slice(this.selectingCards.start, idx + 1);
            } else if (idx < this.selectingCards.start) {
                tmpCards = allCards.slice(idx, this.selectingCards.start + 1);
            } else {
                tmpCards = [card];
            }
            this.selectingCards = { ...this.selectingCards, cards: tmpCards };
            this.setState({ highlightedCards: this.selectingCards.cards });
        }
    }

    computeSingleLineHand(inputCards, fadeClassName = '', cardSelectable = false) {
        const t = this.props.t;
        const cards = inputCards === 'pass' ? inputCards : sortDoudizhuCards(inputCards);
        if (cards === 'pass') {
            return (
                <div className="non-card">
                    <span>{t('doudizhu.pass')}</span>
                </div>
            );
        } else {
            return (
                <div
                    className={`playingCards loose ${fadeClassName} ${
                        this.props.gameStatus === 'playing' && this.props.gamePlayable && cardSelectable
                            ? 'selectable'
                            : 'unselectable'
                    }`}
                >
                    <ul
                        className="hand"
                        style={{
                            width: cardSelectable
                                ? // the user's own hand: the gap between cards comes from --dz-hand-step (see public/custom.css)
                                  `calc(var(--dz-hand-step, 40px) * ${Math.max(cards.length - 1, 0)} + 5.2em + 2px)`
                                : `calc(var(--dz-played-step, 20px) * ${Math.max(cards.length - 1, 0)} + 5.2em + 2px)`,
                        }}
                    >
                        {cards.map((card, idx) => {
                            const [rankClass, suitClass, rankText, suitText] = translateCardData(card);
                            let selected = false;
                            if (this.props.gamePlayable && cardSelectable) {
                                selected = this.props.selectedCards.indexOf(card) >= 0;
                            }

                            return (
                                <li
                                    key={`handCard-${card}`}
                                    style={{ left: cardSelectable ? `calc(var(--dz-hand-step, 40px) * ${idx})` : `calc(var(--dz-played-step, 20px) * ${idx})` }}
                                >
                                    <label
                                        onMouseDown={(e) => {
                                            e.stopPropagation();
                                            cardSelectable && this.handleCardMouseDown(card, idx);
                                        }}
                                        onMouseOver={(e) => {
                                            e.stopPropagation();
                                            cardSelectable && this.handleCardMouseOver(cards, card, idx);
                                        }}
                                        // onClick={() => this.props.handleSelectedCards([card])}
                                        className={`card ${rankClass} ${suitClass} ${selected ? 'selected' : ''} ${
                                            cardSelectable && this.state.highlightedCards.includes(card)
                                                ? 'user-selecting'
                                                : ''
                                        }`}
                                    >
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
    }

    computeSideHand(cards) {
        let upCards;
        let downCards = [];
        if (cards.length > 10) {
            upCards = cards.slice(0, 10);
            downCards = cards.slice(10);
        } else {
            upCards = cards;
        }
        return (
            <div>
                <div className="player-hand-up">
                    <div className="playingCards unselectable loose">
                        <ul className="hand">
                            {upCards.map((card, idx) => {
                                const [rankClass, suitClass, rankText, suitText] = translateCardData(card);
                                return (
                                    <li key={`handCard-${card}`} style={{ left: `calc(var(--dz-ai-hand-step, 18px) * ${idx})` }}>
                                        <label
                                            className={`card ${
                                                this.props.showCardBack ? 'back' : '' + rankClass + ' ' + suitClass
                                            }`}
                                        >
                                            <span className="rank">{rankText}</span>
                                            <span className="suit">{suitText}</span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>
                <div className="player-hand-down">
                    <div className="playingCards unselectable loose">
                        <ul className="hand">
                            {downCards.map((card, idx) => {
                                const [rankClass, suitClass, rankText, suitText] = translateCardData(card);
                                return (
                                    <li key={`handCard-${card}`} style={{ left: `calc(var(--dz-ai-hand-step, 18px) * ${idx})` }}>
                                        <label
                                            className={`card ${
                                                this.props.showCardBack ? 'back' : '' + rankClass + ' ' + suitClass
                                            }`}
                                        >
                                            <span className="rank">{rankText}</span>
                                            <span className="suit">{suitText}</span>
                                        </label>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>
            </div>
        );
    }

    // what is shown in a seat's decision area while the players are bidding
    bidDecisionArea(playerIdx) {
        const t = this.props.t;
        const bidState = this.props.bidState;
        const bid = bidState.bids[playerIdx];
        const bidText = (points) => (points === 0 ? t('doudizhu.bid_pass') : t('doudizhu.bid_points', { points }));

        if (bid !== null && bid !== undefined) {
            return (
                <div className="non-card bid-result">
                    <span>{bidText(bid)}</span>
                </div>
            );
        }
        if (bidState.current === playerIdx && !bidState.finished) {
            if (playerIdx === this.props.mainPlayerId) {
                return (
                    <div className={'main-player-action-wrapper'}>
                        {[0, 1, 2, 3].map((option) => (
                            <Button
                                key={'bid-option-' + option}
                                disabled={option !== 0 && option <= bidState.highest}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    this.props.handleBid(option);
                                }}
                                style={{ marginRight: option < 3 ? '28px' : 0, width: '100px', padding: '10px 0' }}
                                variant="contained"
                                color="primary"
                            >
                                {bidText(option)}
                            </Button>
                        ))}
                        {this.props.gamePlayable && this.props.handleConcede && (
                            // to the right of the bid buttons (it does not move them: it is positioned outside the row)
                            <Button
                                className={'concede-button'}
                                variant="contained"
                                color="primary"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    this.props.handleConcede();
                                }}
                            >
                                <span>
                                    {t('doudizhu.concede_line1')}
                                    <br />
                                    {t('doudizhu.concede_line2')}
                                </span>
                            </Button>
                        )}
                    </div>
                );
            }
            return (
                <div className="non-card">
                    <span>...</span>
                </div>
            );
        }
        return <div className="non-card" />;
    }

    // the line shown in the middle of the table while the players are bidding
    bidStatusMessage() {
        const t = this.props.t;
        const bidState = this.props.bidState;
        if (!bidState) return '';
        const name = (idx) =>
            this.props.playerInfo[idx] && this.props.playerInfo[idx].agentInfo
                ? this.props.playerInfo[idx].agentInfo.name
                : idx === this.props.mainPlayerId
                ? t('doudizhu.you')
                : 'ID ' + idx;
        if (bidState.finished) {
            return bidState.highestBidder < 0
                ? t('doudizhu.bid_all_pass')
                : t('doudizhu.bid_landlord_is', { player: name(bidState.highestBidder), points: bidState.highest });
        }
        if (bidState.current === null) return '';
        return bidState.current === this.props.mainPlayerId
            ? t('doudizhu.bid_your_turn')
            : t('doudizhu.bid_waiting', { player: name(bidState.current) });
    }

    playerDecisionArea(playerIdx) {
        const t = this.props.t;
        if (this.props.gameStatus === 'bidding' && this.props.bidState) return this.bidDecisionArea(playerIdx);
        let fadeClassName = '';
        if (this.props.toggleFade === 'fade-out' && (playerIdx + 2) % 3 === this.props.currentPlayer)
            fadeClassName = 'fade-out';
        else if (this.props.toggleFade === 'fade-in' && (playerIdx + 1) % 3 === this.props.currentPlayer)
            fadeClassName = 'scale-fade-in';
        if (this.props.currentPlayer === playerIdx) {
            if (this.props.mainPlayerId === this.props.playerInfo[this.props.currentPlayer].id) {
                return (
                    <div className={'main-player-action-wrapper'}>
                        <div style={{ marginRight: '2em' }} className={'timer ' + fadeClassName}>
                            {this.props.gameStatus === 'playing' && <Hourglass />}
                        </div>
                        {this.props.gamePlayable ? (
                            <>
                                {/* <Button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        this.props.handleMainPlayerAct('deselect');
                                    }}
                                    style={{ marginRight: '2em' }}
                                    variant="contained"
                                    color="primary"
                                >
                                    {t('doudizhu.deselect')}
                                </Button> */}
                                <Button
                                    disabled={this.props.isHintDisabled || this.props.gameStatus !== 'playing'}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        this.props.handleMainPlayerAct('hint');
                                    }}
                                    style={{ marginRight: '28px', width: '100px', padding: '10px 0' }}
                                    variant="contained"
                                    color="primary"
                                >
                                    {t('doudizhu.hint')}
                                </Button>
                                <Button
                                    disabled={this.props.isPassDisabled || this.props.gameStatus !== 'playing'}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        this.props.handleMainPlayerAct('pass');
                                    }}
                                    style={{ marginRight: '28px', width: '100px', padding: '10px 0' }}
                                    variant="contained"
                                    color="primary"
                                >
                                    {t('doudizhu.pass')}
                                </Button>
                                <Button
                                    // grey (dz-inactive) while the selection is not a legal play, but still clickable
                                    // (it then shows the message); really disabled when it is not the user's turn
                                    className={this.props.isPlayValid ? '' : 'dz-inactive'}
                                    disabled={
                                        this.props.gameStatus !== 'playing' ||
                                        (this.props.isPlayDisabled !== undefined
                                            ? this.props.isPlayDisabled
                                            : !this.props.selectedCards || this.props.selectedCards.length === 0)
                                    }
                                    onClick={(e) => {
                                        console.log('play', e.stopPropagation);
                                        e.stopPropagation();
                                        this.props.handleMainPlayerAct('play');
                                    }}
                                    style={{ width: '100px', padding: '10px 0' }}
                                    variant="contained"
                                    color="primary"
                                >
                                    {t('doudizhu.play')}
                                </Button>
                            </>
                        ) : undefined}
                    </div>
                );
            } else {
                return (
                    <div className={'timer ' + fadeClassName}>
                        {this.props.gameStatus === 'playing' && <Hourglass />}
                    </div>
                );
            }
        } else {
            return this.computeSingleLineHand(this.props.latestAction[playerIdx], fadeClassName);
        }
    }

    componentDidUpdate(prevProps, prevState, snapshot) {
        if (
            this.props.runNewTurn &&
            prevProps.turn !== this.props.turn &&
            this.props.turn !== 0 &&
            this.props.gameStatus === 'playing'
        ) {
            // new turn starts
            this.props.runNewTurn(prevProps);
        }
    }

    render() {
        const t = this.props.t;
        // compute the id as well as index in list for every player
        const bottomId = this.props.mainPlayerId;
        let found = this.props.playerInfo.find((element) => {
            return element.id === bottomId;
        });
        const bottomIdx = found ? found.index : -1;
        const rightIdx = bottomIdx >= 0 ? (bottomIdx + 1) % 3 : -1;
        const leftIdx = rightIdx >= 0 ? (rightIdx + 1) % 3 : -1;
        let rightId = -1;
        let leftId = -1;
        if (rightIdx >= 0 && leftIdx >= 0) {
            found = this.props.playerInfo.find((element) => {
                return element.index === rightIdx;
            });
            if (found) rightId = found.id;
            found = this.props.playerInfo.find((element) => {
                return element.index === leftIdx;
            });
            if (found) leftId = found.id;
        }
        return (
            <div
                className="doudizhu-wrapper"
                onMouseLeave={(e) => {
                    e.stopPropagation();
                    this.handleContainerMouseLeave();
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    this.handleContainerMouseUp();
                }}
            >
                <div
                    id={'gameboard-background'}
                    className={
                        (this.props.gameStatus === 'ready' || this.props.gameStatus === 'localeSelection') &&
                        this.props.gamePlayable
                            ? 'blur-background'
                            : undefined
                    }
                >
                    <div id={'left-player'}>
                        <div className="player-main-area">
                            <div className="player-info">{this.computePlayerPortrait(leftId, leftIdx)}</div>
                            {leftIdx >= 0 ? (
                                this.computeSideHand(this.props.hands[leftIdx])
                            ) : (
                                <div className="player-hand-placeholder">
                                    <span>{t('waiting...')}</span>
                                </div>
                            )}
                        </div>
                        <div className="played-card-area">{leftIdx >= 0 ? this.playerDecisionArea(leftIdx) : ''}</div>
                    </div>
                    <div id={'right-player'}>
                        <div className="player-main-area">
                            <div className="player-info">{this.computePlayerPortrait(rightId, rightIdx)}</div>
                            {rightIdx >= 0 ? (
                                this.computeSideHand(this.props.hands[rightIdx])
                            ) : (
                                <div className="player-hand-placeholder">
                                    <span>{t('waiting...')}</span>
                                </div>
                            )}
                        </div>
                        <div className="played-card-area">{rightIdx >= 0 ? this.playerDecisionArea(rightIdx) : ''}</div>
                    </div>
                    <div id={'bottom-player'}>
                        <div className="played-card-area">
                            {bottomIdx >= 0 ? this.playerDecisionArea(bottomIdx) : ''}
                        </div>
                        <div className="player-main-area">
                            <div className="player-info">{this.computePlayerPortrait(bottomId, bottomIdx)}</div>
                            {bottomIdx >= 0 ? (
                                <div className="player-hand">
                                    {this.computeSingleLineHand(this.props.hands[bottomIdx], '', true)}
                                </div>
                            ) : (
                                <div className="player-hand-placeholder">
                                    <span>{t('waiting...')}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                {this.props.gamePlayable && this.props.gameStatus === 'ready' && (
                    <Layout.Row
                        type="flex"
                        style={{
                            position: 'absolute',
                            top: 0,
                            height: '100%',
                            width: '100%',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: 'center',
                        }}
                    >
                        {/* the role is no longer picked here: it is decided by bidding */}
                        <Button
                            onClick={() => this.props.handleStartBidding()}
                            style={{ width: '225px', justifyContent: 'space-evenly' }}
                            variant="contained"
                            color="primary"
                            startIcon={<img src={Landlord_wName} alt="Landlord" width="48px" height="48px" />}
                        >
                            {t('doudizhu.start_game')}
                        </Button>
                    </Layout.Row>
                )}
                {this.props.gamePlayable && this.props.gameStatus === 'bidding' && (
                    <div
                        style={{
                            position: 'absolute',
                            top: 0,
                            height: '100%',
                            width: '100%',
                            display: 'flex',
                            justifyContent: 'center',
                            alignItems: 'center',
                            pointerEvents: 'none',
                        }}
                    >
                        <span
                            style={{
                                color: '#F2F6FC',
                                fontSize: '26px',
                                fontWeight: 'bold',
                                textShadow: '0 2px 2px rgba(0, 0, 0, 0.87)',
                            }}
                        >
                            {this.bidStatusMessage()}
                        </span>
                    </div>
                )}
                {this.props.gamePlayable && this.props.gameStatus === 'localeSelection' && (
                    <Layout.Row
                        type="flex"
                        style={{
                            position: 'absolute',
                            top: 0,
                            height: '100%',
                            width: '100%',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: 'center',
                        }}
                    >
                        <Button
                            onClick={() => this.props.handleLocaleChange('zh')}
                            style={{ width: '225px', padding: '15px' }}
                            variant="contained"
                            color="primary"
                        >
                            中文开始游戏
                        </Button>
                        <Button
                            onClick={() => this.props.handleLocaleChange('en')}
                            style={{ width: '225px', padding: '15px', marginTop: '20px' }}
                            variant="contained"
                            color="primary"
                        >
                            Start Game in English
                        </Button>
                    </Layout.Row>
                )}
            </div>
        );
    }
}

// keeps the preloaded portraits referenced (and so in the browser cache)
DoudizhuGameBoard.portraitPreload = portraitPreload;

export default withTranslation()(DoudizhuGameBoard);
