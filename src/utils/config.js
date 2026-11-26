const apiUrl = 'http://127.0.0.1:8000';
// Address of the DouZero backend (pve_server/run_douzero.py).
// Build with REACT_APP_DOUZERO_URL set to an empty string to use "the same host and port as this page",
// which is what happens when run_douzero.py serves the built web page itself.
const douzeroDemoUrl =
    process.env.REACT_APP_DOUZERO_URL !== undefined ? process.env.REACT_APP_DOUZERO_URL : 'http://127.0.0.1:5000';

export { apiUrl, douzeroDemoUrl };
