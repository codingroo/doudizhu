// 结算窗口的评语。用文本编辑器修改这个文件即可(不用重新构建),保存后用 Ctrl+F5 刷新页面。
//
// 规则从上到下依次检查,第一条条件成立的规则生效(所以越具体的规则要写在越上面),
// 再从它的 say 列表里随机选一个词。想加词,直接往 say 的方括号里添加就行。
//
// 条件(when)里可以使用下面这些变量,按 JavaScript 的写法组合:
//   &&  并且      ||  或者      !  取反      ==  等于      >  <  >=  <=  比较大小
//
//   win            你这一方赢了(你的农民队友赢了也算)
//   lose           你这一方输了
//   landlord       你本局是地主
//   peasant        你本局是农民
//   bomb           本局全部炸弹数(炸弹和火箭都算1个)
//   self_bomb      你自己出的炸弹数
//   other_bomb     别人(包括你的队友)出的炸弹数
//   spring         本局是春天(地主赢,且两个农民一手都没出过)
//   reverse_spring 本局是反春(农民赢,且地主只出过第一手)
//   hand_left      本局结束时你手里还剩几张牌
//   base           底分
//   multiplier     最终倍数
//   concede        你点了"直接认输"(此时 lose 也为真)。点了认输后只检查 when 里写了 concede 的规则,
//                  没有这样的规则就显示默认的"认输";例如 { when: 'concede', say: ['...'] }
//
// 写错的条件会被跳过(并在浏览器的控制台里提示),不会影响游戏。
// 如果没有任何规则成立,或者这个文件不存在,就显示默认的"地主胜利!/农民胜利!"。
window.DOUDIZHU_PHRASES = {
    rules: [
        { when: 'concede', say: ['大丈夫能屈能伸 \u{1F41B}'] },
        
        { when: 'win && spring && self_bomb > 0', say: ['牌运爆棚 \u{1F4A5}', '鸿运当头 \u{1F3B0}'] },
        { when: 'win && spring', say: ['完美发挥 \u{1F4AF}', '行云流水 \u{26F5}', '无懈可击 \u{1F4AF}', '闪电战 \u{26A1}'] },
        { when: 'win && reverse_spring && hand_left == 0', say: ['摧枯拉朽 \u{270C}\uFE0F', '轻松拿捏 \u{2615}'] },
        { when: 'win && reverse_spring', say: ['翻身农奴把歌唱 \u{1F9D4}\u{1F9D4}'] },
        { when: 'win && self_bomb > 1', say: ['炸弹超人 \u{1F4A3}'] },
        { when: 'win && landlord && self_bomb > 0', say: ['酣畅淋漓 \u{1F604}', '神机妙算 \u{1F52F}', '算无遗策 \u{1F3AF}', '横扫千军 \u{2694}\uFE0F', '势如破竹 \u{1FA93}'] },
        { when: 'win && landlord && other_bomb > 0', say: ['有惊无险 \u{1F472}', '尽在掌控 \u{1F44C}', '跌宕起伏 \u{1F3A2}'] },
        { when: 'win && hand_left > 0 && self_bomb > 0', say: ['锦上添花 \u{1F337}', '推波助澜 \u{1F30A}'] },
        { when: 'win && peasant && other_bomb > 0', say: ['团结就是力量 \u{1F46F}'] },
        { when: 'win && hand_left == 17', say: ['无所事事 \u{1F6C0}', '沦为路人 \u{1F6B6}'] },
        { when: 'win && hand_left > 14', say: ['隔岸观火 \u{1F525}'] },
        { when: 'win && hand_left > 11', say: ['队友给力 \u{1F4AA}'] },
        { when: 'win && base == 1 && bomb == 0', say: ['蚊子肉也是肉 \u{1F99F}', '锱铢必较 \u{1F9D0}'] },
        { when: 'win && peasant && hand_left == 0', say: ['妙手连连 \u{1F44F}', '完美应对 \u{1F93A}', '作风优良 \u{1F436}'] },
        { when: 'win', say: ['敢打敢拼 \u{1F94A}', '思虑周全 \u{1F389}', '运筹帷幄 \u{1F52E}', '精打细算 \u{1F9EE}','能打胜仗 \u{1F415}'] },

        { when: 'lose && spring', say: ['毫无还手之力 \u{1F640}'] },
        { when: 'lose && reverse_spring', say: ['一败涂地 \u{1F926}'] },
        { when: 'lose && bomb > 1', say: ['体无完肤 \u{2620}\uFE0F', '雪上加霜 \u{2603}\uFE0F'] },
        { when: 'lose && hand_left < 3', say: ['功亏一篑 \u{1F4B8}', '功败垂成 \u{1F494}'] },
        { when: 'lose && hand_left > 16', say: ['有人出千 \u{1F0CF}'] },
        { when: 'lose && hand_left > 14', say: ['掀翻牌桌 \u{1F937}'] },
        { when: 'lose && hand_left > 12', say: ['心有余而力不足 \u{1F425}', '力不从心 \u{1F61E}'] },
        { when: 'lose && hand_left > 10', say: ['手气欠佳 \u{1F940}', '时运不济 \u26C8\uFE0F'] },
        { when: 'lose && base == 1 && bomb == 0', say: ['小打小闹 \u{1F9F8}'] },
        { when: 'lose', say: ['再接再厉 \u{26FD}', '屡败屡战 \u{26FD}', '力有不逮 \u{267F}', '无可奈何 \u{1F440}'] },
    ],
};
