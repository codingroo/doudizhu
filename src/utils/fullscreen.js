// Fullscreen for the whole page (used by the button in the header and by the "exit fullscreen" button of the table).
//
// Phones (Android Chrome and the like): the screen is turned to landscape as soon as the page is fullscreen, and let go
// when the fullscreen ends. Where the browser cannot do this (iPhone, a computer) or refuses, nothing happens at all.

export const lockLandscape = () => {
    try {
        if (window.screen && window.screen.orientation && window.screen.orientation.lock) {
            const result = window.screen.orientation.lock('landscape');
            if (result && result.catch) result.catch(() => {});
        }
    } catch (e) {
        // not possible here: ignore
    }
};

export const unlockOrientation = () => {
    try {
        if (window.screen && window.screen.orientation && window.screen.orientation.unlock) {
            window.screen.orientation.unlock();
        }
    } catch (e) {
        // ignore
    }
};

export const toggleFullscreen = () => {
    if (document.fullscreenElement) {
        document.exitFullscreen();
        unlockOrientation();
    } else if (document.documentElement.requestFullscreen) {
        const request = document.documentElement.requestFullscreen();
        // the screen can only be locked when the page is already fullscreen
        if (request && request.then) request.then(lockLandscape, () => {});
        else lockLandscape();
    }
};
