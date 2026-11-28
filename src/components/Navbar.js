import React, { useEffect, useState } from "react";
import { useTranslation } from 'react-i18next';
import logo_white from "../assets/images/logo_white.png";
import AppBar from "@material-ui/core/AppBar";
import Button from "@material-ui/core/Button";
import { toggleFullscreen } from "../utils/fullscreen";

function Navbar() {
    const { t } = useTranslation();
    const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);

    useEffect(() => {
        const update = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', update);
        return () => document.removeEventListener('fullscreenchange', update);
    }, []);

    return (
        <AppBar position="fixed" className={"header-bar-wrapper"}>
            <div className={"header-bar"}>
                {/* the fullscreen button is where the logo was: the first thing a phone user can reach */}
                <Button className={"header-fullscreen-button"} variant="outlined" onClick={toggleFullscreen}>
                    {isFullscreen ? t('doudizhu.exit_fullscreen') : t('doudizhu.fullscreen')}
                </Button>
                {/* the logo and the title are in the middle of the page */}
                <div className={"header-center"}>
                    <img src={logo_white} alt={"Logo"} height="65px" />
                    <div className={"title unselectable"}><div className={"title-text"}>斗地主<span className={"subtitle"}>智能单机版</span></div></div>
                </div>
            </div>
        </AppBar>
        )

}

export default Navbar;
