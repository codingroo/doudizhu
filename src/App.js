import React from 'react';
import { BrowserRouter as Router, Redirect, Route } from 'react-router-dom';
import Navbar from './components/Navbar';
import LeaderBoard from './view/LeaderBoard';
import { PvEDoudizhuDemoView } from './view/PvEView';
import { DoudizhuReplayView, LeducHoldemReplayView } from './view/ReplayView';

const navbarSubtitleMap = {
    '/leaderboard': '',
    '/replay/doudizhu': 'Doudizhu',
    '/replay/leduc-holdem': "Leduc Hold'em",
    '/doudizhu': 'Doudizhu PvE',
};

function App() {
    // todo: add 404 page
    return (
        <Router>
            <Navbar />
            <div style={{ marginTop: '75px' }}>
                <Route exact path="/">
                    <Redirect to="/leaderboard?type=game&name=leduc-holdem" />
                </Route>
                <Route path="/leaderboard" component={LeaderBoard} />
                <Route path="/replay/doudizhu" component={DoudizhuReplayView} />
                <Route path="/replay/leduc-holdem" component={LeducHoldemReplayView} />
                <Route path="/doudizhu" component={PvEDoudizhuDemoView} />
            </div>
        </Router>
    );
}

export default App;
