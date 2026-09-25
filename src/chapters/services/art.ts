import { P } from '../../kit/pixel'
import { PLAYER1 } from '../../kit/player1'

/*
 * Pixel art for the Power-Ups level, as ASCII. One char = one pixel (or one
 * voxel). '.' is empty. Art is drawn WITHOUT its dark outline — outline()
 * adds a 1px void rim around every filled pixel, so silhouettes survive the
 * CRT pass's pixelation and palette snap.
 *
 * Key (Hark-16):
 *   k void  n night  i indigo  p purple  m magenta  r coral  o orange
 *   y gold  c cream  w white   s steel   l slate    G signal g green
 *   q pine  a cyan   b blue    B brown
 */
export const KEY: Record<string, string> = {
  k: P.void,
  n: P.night,
  i: P.indigo,
  p: P.purple,
  m: P.magenta,
  r: P.coral,
  o: P.orange,
  y: P.gold,
  c: P.cream,
  w: P.white,
  s: P.steel,
  l: P.slate,
  G: P.signal,
  g: P.green,
  q: P.pine,
  a: P.cyan,
  b: P.blue,
  B: P.brown,
}

/** Pad by one pixel and rim every filled pixel (8-neighbour) with `ch`. */
export function outline(rows: string[], ch = 'k'): string[] {
  const h = rows.length + 2
  const w = Math.max(...rows.map(r => r.length)) + 2
  const at = (x: number, y: number) => {
    const r = rows[y - 1]
    const c = r?.[x - 1]
    return c !== undefined && c !== '.' && c !== ' '
  }
  const out: string[] = []
  for (let y = 0; y < h; y++) {
    let s = ''
    for (let x = 0; x < w; x++) {
      if (at(x, y)) s += rows[y - 1][x - 1]
      else {
        let n = false
        for (let dy = -1; dy <= 1 && !n; dy++) for (let dx = -1; dx <= 1 && !n; dx++) if (at(x + dx, y + dy)) n = true
        s += n ? ch : '.'
      }
    }
    out.push(s)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* the eleven power-ups, in SERVICES order                              */
/* ------------------------------------------------------------------ */

/** 01 Software Development: a gear with a signal ring round its hub */
const GEAR = [
  '.....wwss.....',
  '.ww..wsss..sl.',
  '.www.ssss.sll.',
  '..wsssssssll..',
  '..wsssGGsssl..',
  'wwsssG..Gsssll',
  'wsssG....Gsssl',
  'wsssG....Gsssl',
  'wssssG..Gsssll',
  '..ssssGGsssl..',
  '..sssssssssl..',
  '.sss.ssss.lll.',
  '.sl..ssll..ll.',
  '.....slll.....',
]

/** 02 Web Design: a paintbrush, magenta-loaded */
const BRUSH = [
  '..........rmm.',
  '.........rmmmm',
  '........rmmmmm',
  '........mmmmm.',
  '.......wsmmm..',
  '......wssl....',
  '.....wssl.....',
  '....oosl......',
  '...oooB.......',
  '..oooB........',
  '.oooB.........',
  '.ooB..........',
  '.oB...........',
]

/** 03 Ecommerce: a shopping cart with goods */
const CART = [
  '......yy.rr...',
  'rr...yyyyrrr..',
  '.r...yyooyrrr.',
  '.rwwwwwwwwwwww',
  '..ssssssssssss',
  '..llllllllllll',
  '...ssssssssss.',
  '...ssssssssss.',
  '....llllllll..',
  '....l.........',
  '....sssssssss.',
  '.....ll...ll..',
  '.....ll...ll..',
]

/** 04 SEO / GEO: a magnifying glass */
const LENS = [
  '...ssss.......',
  '.sswwwwss.....',
  '.swaaaaals....',
  'swaawaaaals...',
  'swawaaaaals...',
  'swaaaaaaals...',
  'swaaaaaaals...',
  '.slaaaaalls...',
  '.sslllllsBo...',
  '...sssss.Boo..',
  '..........Boo.',
  '...........Boo',
  '............Bo',
]

/** 05 Page Speed: a lightning bolt */
const BOLT = [
  '......wwyyy',
  '.....wyyyo.',
  '....wyyyo..',
  '...wyyyo...',
  '..wyyyo....',
  '.wyyyyyyyy.',
  '..oooyyyyo.',
  '.....yyyo..',
  '....yyyo...',
  '...yyyo....',
  '..yyo......',
  '.yo........',
  'yo.........',
]

/** 06 AI Consulting: a chip that says AI */
const CHIP = [
  '...s.s..s.s...',
  '...s.s..s.s...',
  '..nniiiiiiii..',
  'ssniiiiiiiiiss',
  '..iiGiiGGGii..',
  'ssiGiGiiGiiiss',
  '..iGGGiiGiii..',
  '..iGiGiiGiii..',
  'ssiGiGiGGGiiss',
  '..iiiiiiiiii..',
  'ssiiiiiiiiinss',
  '..iiiiiiiinn..',
  '...s.s..s.s...',
  '...s.s..s.s...',
]

/** 07 Aerial Photography & Video: a camera drone */
const DRONE = [
  'wwwwws....swwwww',
  '..s..........s..',
  '.rsss......sssG.',
  '...sswwwwwwss...',
  '....wwwwwwww....',
  '.....ssssss.....',
  '......laal......',
  '......lawl......',
  '....s......s....',
  '...ss......ss...',
]

/** 08 Hack Remediation: a med-kit */
const MEDKIT = [
  '.....BBBB.....',
  '....B....B....',
  'wwwwwwwwwwwwws',
  'wccccrrrrccccs',
  'wccccrrrrccccs',
  'wccrrrrrrrrccs',
  'wccrrrrrrrrccs',
  'wccrrrrrrrrccs',
  'wccrrrrrrrrccs',
  'wccccrrrrccccs',
  'wccccrrrrccccs',
  'ssssssssssssss',
]

/** 09 Website & Data Security: a shield with a check */
const SHIELD = [
  'wwwwwwwwwwwwws',
  'wbbbbbbiiiiiis',
  'wbbbbbbiiiiiis',
  'wbbbbbbiiiiGis',
  'wbbbbbbiiiGGis',
  'wbGbbbbiiGGiis',
  'wbGGbbbiGGiiis',
  'wbbGGbbGGiiiis',
  '.wbbGGGGiiiis.',
  '.wbbbGGiiiiis.',
  '..wbbbbiiiis..',
  '...wbbbiiis...',
  '....wbbiis....',
  '.....wbis.....',
  '......ws......',
]

/** 10 ADA Accessibility: the access figure */
const ACCESS = [
  '....bbbbbb....',
  '..bbbbwwbbbb..',
  '.bbbbbwwbbbbb.',
  '.bbbbbbbbbbbb.',
  'bwwwwwwwwwwwwb',
  'bbbbbbwwbbbbbb',
  'bbbbbbwwbbbbbb',
  'bbbbbbwwbbbbbb',
  'bbbbbwwwwbbbbb',
  'bbbbwwbbwwbbbb',
  '.bbwwbbbbwwbb.',
  '.bbbbbbbbbbbb.',
  '..bbbbbbbbbb..',
  '....bbbbbb....',
]

/** 11 WordPress: a letter block */
const WBLOCK = [
  'wwwwwwwwwwwwwc',
  'wccccccccccccs',
  'wciicccccciics',
  'wciicccccciics',
  'wciicciicciics',
  'wciicciicciics',
  'wciiciiiiciics',
  'wciiiicciiiics',
  'wciiicccciiics',
  'wciicccccciics',
  'wccccccccccccs',
  'csssssssssssss',
]

export const ICONS: string[][] = [GEAR, BRUSH, CART, LENS, BOLT, CHIP, DRONE, MEDKIT, SHIELD, ACCESS, WBLOCK].map(a => outline(a))

/** short names for the inventory slots */
export const SHORT = ['Software', 'Web Design', 'Ecommerce', 'SEO / GEO', 'Page Speed', 'AI', 'Aerial', 'Remediation', 'Security', 'ADA', 'WordPress']

/* ------------------------------------------------------------------ */
/* the player: PLAYER 1, side view (kit/player1.ts is the spec)         */
/* ------------------------------------------------------------------ */

/*
 * Hood up (signal green, the back and underside in green), white-cupped
 * headphones over the hood on a void band, cream face, void eye, coral
 * cheek, indigo trousers, white trainers. Facing right. The frames use their
 * own key (HERO_KEY) so every colour comes straight from the PLAYER1 spec:
 *
 *   G hood   g hood shade   h phones band   w phones cup   s cup grille
 *   c face/hands   e eyes   r cheeks   i trousers   W trainers
 */
export const HERO_KEY: Record<string, string> = {
  k: PLAYER1.outline,
  G: PLAYER1.hood,
  g: PLAYER1.hoodShade,
  h: PLAYER1.phonesBand,
  w: PLAYER1.phonesCup,
  s: P.steel,
  c: PLAYER1.face,
  e: PLAYER1.eyes,
  r: PLAYER1.cheeks,
  i: PLAYER1.pants,
  W: PLAYER1.shoes,
}

const HERO_IDLE = [
  '....GGGGGG....',
  '...GGhhhhGG...',
  '..gGhGGGGGGG..',
  '..ghGGGGGGGGG.',
  '.wwwGGGGGGGGG.',
  '.wswGGGggggg..',
  '.wswGGgcccec..',
  '.wwwGgccccec..',
  '..gggccccccrc.',
  '...gggcccccc..',
  '....ggcccc....',
  '...gGgGGGGG...',
  '..gGGgGGGGGc..',
  '..cgggggggg...',
  '...iiiiiii....',
  '...iii.iii....',
  '..WWWW.WWWW...',
]

const HERO_RUN_A = [
  '....GGGGGG....',
  '...GGhhhhGG...',
  '..gGhGGGGGGG..',
  '..ghGGGGGGGGG.',
  '.wwwGGGGGGGGG.',
  '.wswGGGggggg..',
  '.wswGGgcccec..',
  '.wwwGgccccec..',
  '..gggccccccrc.',
  '...gggcccccc..',
  '....ggcccc....',
  '..cgGgGGGGG...',
  '...gGgGGGGGGc.',
  '...gggggggg...',
  '..iiiiiiiii...',
  '.ii.......ii..',
  'WWW.......WWW.',
]

const HERO_RUN_B = [
  '..............',
  '....GGGGGG....',
  '...GGhhhhGG...',
  '..gGhGGGGGGG..',
  '..ghGGGGGGGGG.',
  '.wwwGGGGGGGGG.',
  '.wswGGGggggg..',
  '.wswGGgcccec..',
  '.wwwGgccccec..',
  '..gggccccccrc.',
  '...gggcccccc..',
  '....ggcccc....',
  '...gGgGGGGG...',
  '...gGgcgggg...',
  '...iiiiiii....',
  '....iiii......',
  '....WWWWW.....',
]

const HERO_JUMP = [
  '..........c...',
  '....GGGGGGc...',
  '...GGhhhhGgG..',
  '..gGhGGGGGGgG.',
  '..ghGGGGGGGgG.',
  '.wwwGGGGGGGGG.',
  '.wswGGGggggg..',
  '.wswGGgcccec..',
  '.wwwGgccccec..',
  '..gggccccccrc.',
  '...gggcccccc..',
  '....ggcccc....',
  '...gGgGGGG....',
  '..cgggggggg...',
  '...iiiiiiii...',
  '..iii...iiWW..',
  '..WWW....WW...',
]

const HERO_CHEER = [
  '.c..........c.',
  '.G..GGGGGG..G.',
  '.gGgGhhhhGgGg.',
  '..gGhGGGGGGG..',
  '..ghGGGGGGGGG.',
  '.wwwGGGGGGGGG.',
  '.wswGGGggggg..',
  '.wswGGgeccec..',
  '.wwwGgccccccc.',
  '..gggcceeecrc.',
  '...gggcccccc..',
  '....ggcccc....',
  '...gGGGGGGG...',
  '...gggggggg...',
  '...iiiiiii....',
  '...iii.iii....',
  '..WWWW.WWWW...',
]

export const HERO = {
  idle: outline(HERO_IDLE),
  runA: outline(HERO_RUN_A),
  runB: outline(HERO_RUN_B),
  jump: outline(HERO_JUMP),
  cheer: outline(HERO_CHEER),
}

/* ------------------------------------------------------------------ */
/* level props                                                          */
/* ------------------------------------------------------------------ */

const COIN = [
  '.yyyy.',
  'ycyyyo',
  'ycyoyo',
  'ycyoyo',
  'ycyoyo',
  'ycyoyo',
  'yyyyoo',
  '.oooo.',
]
export const COIN_ART = outline(COIN)

const BUSH = [
  '......GGGG..............',
  '....GGggggGG.....GGG....',
  '...GggggggggG...GgggG...',
  '..GgggggggggggGGggggggG.',
  '.GgggggggqggggggggqgggG.',
  'GggqgggggggggqgggggggggG',
  'gggggqggggggggggqgggqggg',
  'qqqqqqqqqqqqqqqqqqqqqqqq',
]
export const BUSH_ART = outline(BUSH)

const BUSH_S = [
  '...GGG.....',
  '.GGgggGGG..',
  'GgggggggggG',
  'ggqgggggqgg',
  'qqqqqqqqqqq',
]
export const BUSH_S_ART = outline(BUSH_S)

const FLOWER_A = [
  '.r.r.',
  'rrcrr',
  '.rrr.',
  '..g..',
  '.gg..',
  '..g..',
]
const FLOWER_B = [
  '.y.y.',
  'yywyy',
  '.yyy.',
  '..g..',
  '..gg.',
  '..g..',
]
export const FLOWER_ARTS = [outline(FLOWER_A), outline(FLOWER_B)]

const SIGN = [
  'BBBBBBBBBBBBBB.',
  'BoooooooooooooB',
  'BoooooowoooooBB',
  'BoooooowwooooBB',
  'BowwwwwwwwoooBB',
  'BoooooowwooooBB',
  'BoooooowoooooBB',
  'BBBBBBBBBBBBBB.',
  '.....BoB.......',
  '.....BoB.......',
  '.....BoB.......',
  '.....BoB.......',
  '.....BoB.......',
]
export const SIGN_ART = outline(SIGN)

const FLAG = [
  'c.........',
  'cGGGGGG...',
  'cGGGGGGGG.',
  'cGGqGGGGGG',
  'cGGGGGGGG.',
  'cGGGGGG...',
  'c.........',
  'c.........',
  'c.........',
  'c.........',
  'c.........',
  'c.........',
  'c.........',
  'c.........',
  'c.........',
  'c.........',
  'c.........',
  'c.........',
  'ss........',
  'ss........',
]
export const FLAG_ART = outline(FLAG)
