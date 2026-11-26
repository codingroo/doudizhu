// Settings. Edit this file with a text editor (no rebuild needed), then reload the page with Ctrl+F5.
window.DOUDIZHU_SETTINGS = {
    // true: a new game (bidding) starts by itself when the page opens and after "再来一局";
    // false: wait for a click on the 开始游戏 button
    autoStart: true,
    // how long (milliseconds) to wait after the last card before the result window opens
    resultDelayMs: 100,
    // how long (milliseconds) the bidding result is shown before the three bottom cards are turned over
    // and the game starts
    bidResultDelayMs: 100,
    // starting position of the "AI考虑时间" slider at the bottom of the page, in milliseconds.
    // It must be one of the slider's steps: 0, 1000, 3000, 5000, 10000, 30000
    // (anything else falls back to 3000). The slider can still be moved during a game.
    aiThinkingTimeMs: 0,
    // how long (minutes) a deal is kept: if the page is reloaded (F5, or the phone reloads it after it was left alone)
    // within this time, the same cards come back; later, there is a new deal. A game never takes this long.
    dealKeepMinutes: 10,
};
