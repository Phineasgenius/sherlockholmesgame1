'use strict';
/*
 * SERVER-SIDE ONLY. This file is never sent to the browser.
 * It holds every puzzle, hint and answer. Keep your GitHub repo PRIVATE.
 *
 * Answers are compared after lower-casing and stripping everything that is not a-z / 0-9,
 * so "Light House" == "lighthouse". List alternatives in `answers` (first one is canonical).
 *
 * Block kinds the front-end understands:
 *   text    {text}                       monospace block (ciphers, coordinates, lists)
 *   lab     {asset, tools}               image lab. tools: levels, invert, channels, bits
 *   blink   {units, unitMs}              flashing lamp; units alternate ON/OFF durations
 *   console {lines}                      lines printed to the browser console
 *   ember   {attr, value}                invisible element carrying a data-attribute
 */
const HINT_PENALTY_MIN = 3; // every hint adds this many minutes to the leaderboard time

const LEVELS = [
  {
    title: 'The dark photograph',
    story: [
      'Old Marrow kept the Greywater Light for forty winters. In the autumn gale he vanished, leaving a chest sealed with a single word.',
      'The first page of his logbook holds one photograph. It shows a plain wall and a sign. Marrow never wasted film.',
      'Bring out what the dark is hiding, then give him the word.'
    ],
    blocks: [{ kind: 'lab', asset: 'lab1.png', tools: ['levels', 'invert'] }],
    hints: [
      'The picture is not empty, only very dark. Move the black point and white point sliders close together near the dark end (the hidden writing lives between roughly 30 and 50).'
    ],
    answers: ['lantern']
  },
  {
    title: 'A letter in another hand',
    story: [
      'Marrow wrote to the relief keeper in a cipher. He always locked his letters with the last word he had shown you.',
      'Each letter below is shifted by a letter of that word, round and round.'
    ],
    blocks: [{ kind: 'text', text: 'TAZTP NNJSO XLZAO YBNEK AZOAB EDOPN RTXYL ZUNMH LFVIF MVVGN HOXCF AOAYE QVNDU EXAYN EAZB' }],
    hints: [
      'A repeating-key shift cipher: the Vigen\u00E8re cipher. The key is the answer to the previous level; any online decoder will do.'
    ],
    answers: ['shadow', 'ashadow']
  },
  {
    title: 'The silent page',
    story: [
      'The next page looks blank. It is not empty, only quiet. Marrow said some pages speak only to those who open the keeper’s toolbox.',
      'The word is in two halves. Neither half is written where you are looking.'
    ],
    blocks: [
      { kind: 'console', lines: ['[logbook] first half of the word: bea', '[logbook] the second half is kept on this page, out of sight.'] },
      { kind: 'ember', attr: 'data-second-half', value: 'Y29u' }
    ],
    hints: [
      'Open your browser\u2019s developer tools (F12, or right-click then Inspect). The Console holds the first half; the second half is a Base64-encoded attribute on a hidden element in the Elements panel.'
    ],
    answers: ['beacon']
  },
  {
    title: 'The beacon speaks',
    story: [
      'Marrow’s lamp never turned in his last weeks. It only flashed, again and again, the same message to ships that were not there.',
      'Watch it, and write down what it says.'
    ],
    blocks: [{ kind: 'blink', unitMs: 380, units: [3,1,1,1,3,1,1,3,3,1,3,1,3,3,3,1,3,3,1,1,3,1,3,1,1,3,1,1,3,3,1,1,1,1,1,3,1,1,1,1,1] }],
    hints: [
      'Short and long flashes: Morse code (a long flash is three times as long as a short one). The word has seven letters and helps a sailor find north.'
    ],
    answers: ['compass']
  },
  {
    title: 'The keeper’s arithmetic',
    story: [
      'Marrow counted everything: steps, stones, waves. Here he counted letters.',
      'He wrote each letter as its place in the alphabet, then lifted every count by the length of the last word you gave him.'
    ],
    blocks: [{ kind: 'text', text: '8   21   10   15   22   25' }],
    hints: [
      'A=1, B=2, C=3 and so on, but these numbers are too high. Subtract the number of letters in the previous answer from each, then turn the numbers back into letters.'
    ],
    answers: ['anchor']
  },
  {
    title: 'Seven layers of sea',
    story: [
      'A postcard slipped between the pages. On the back, in pencil: “Every picture is a stack of pictures. The secret hides in the thinnest one.”',
      'The viewer below can pull a picture apart by colour and by layer.'
    ],
    blocks: [{ kind: 'lab', asset: 'lab2.png', tools: ['levels', 'channels', 'bits', 'invert'] }],
    hints: [
      'Pull the picture apart with the viewer: try the blue channel at bit layer 0 (the thinnest layer). A few stray dots are only noise.'
    ],
    answers: ['harbor', 'harbour']
  },
  {
    title: 'The locked ledger',
    story: [
      'The ledger’s last pages are locked with a square of twenty-five letters, worked in pairs. Marrow built the square around the name of the place on the postcard.',
      'The ciphertext is in blocks of four. Ignore the spaces.'
    ],
    blocks: [{ kind: 'text', text: 'PBDX HBFW GZXL DLLP OROL HDSL' }],
    hints: [
      'This is the Playfair cipher (5\u00D75 grid, I and J share a cell). The keyword is the answer to the previous level; read through any X or Z padding.'
    ],
    answers: ['barnacle']
  },
  {
    title: 'The first light',
    story: [
      'Marrow’s lamp was a copy of a far older light, one of the Seven Wonders of the ancient world. The ledger gives only its position.',
      'In which city did the original stand?'
    ],
    blocks: [{ kind: 'text', text: '31.2139 N,  29.8853 E' }],
    hints: [
      'Paste the coordinates into any map app. A harbour fortress stands there today, in a city named after a famous conqueror.'
    ],
    answers: ['alexandria', 'alexandriaegypt']
  },
  {
    title: 'The chest',
    story: [
      'You have shown Marrow every light he ever lit. The chest has one lock left, and its combination is written in stones on the last page.',
      'Each stone belongs to one of your answers, in the order you gave them. Take the stated letter from each answer and read them in order. The result is the word that opens the chest.'
    ],
    blocks: [{ kind: 'text', text:
      'Answer 1, letter 1\nAnswer 2, letter 5\nAnswer 3, letter 5\nAnswer 4, letter 4\nAnswer 5, letter 4\nAnswer 6, letter 5\nAnswer 7, letter 7\nAnswer 8, letter 3' }],
    hints: [
      'Your journal lists every answer. Take the stated letter from each, in order. Eight letters make a word that has nothing to do with lighthouses.'
    ],
    answers: ['loophole']
  }
];

// Shown (from the server) only to players who solve the last level.
const FINAL_CODE = 'ebutuoytasuinegsaenihptaht';

module.exports = { LEVELS, HINT_PENALTY_MIN, FINAL_CODE, GAME_TITLE: 'The Greywater Light' };
