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
      'The picture is not empty, only very dark. Your eyes cannot separate shades that close together, but a slider can.',
      'Move the black point and white point sliders close together near the dark end. The hidden writing lives between roughly 30 and 50.'
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
      'A repeating-key shift cipher: the Vigenère cipher.',
      'The key is the answer to the previous level. Any online Vigenère decoder will do.'
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
      'Your browser has built-in developer tools (F12, or right-click then Inspect). Look at both the Console and the Elements panel.',
      'The Console gives you the first half. The second half is an attribute on a hidden element, and it is encoded.',
      'The encoding is Base64. The text ends in "u" and decodes to three letters.'
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
      'Short flash, long flash: Morse code. A long flash is three times as long as a short one.',
      'A long dark gap marks the end of a letter. The word has seven letters and helps a sailor find north.'
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
      'A=1, B=2, C=3 and so on. But these numbers are too high for a plain code.',
      'Subtract the number of letters in the previous answer from each number, then turn the numbers back into letters.'
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
      'Each colour channel of a pixel is stored as 8 bits. Use the layer control to look at one bit at a time.',
      'Try the blue channel, bit 0 (the thinnest layer). A few stray dots are only noise.'
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
      'Letters are enciphered two at a time on a 5×5 grid where I and J share a cell. This is the Playfair cipher.',
      'The keyword is the answer to the previous level. Decoders may add X or Z as padding; read through it.'
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
      'Paste the coordinates into any map app.',
      'A harbour fortress stands there today, built from the ruins of the tower. The city is named after a famous conqueror.'
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
      'Your journal lists every answer you have given. "Letter 1" means the first letter of that answer.',
      'Eight letters, one from each answer. The result is a word, but not one connected to lighthouses.'
    ],
    answers: ['loophole']
  }
];

module.exports = { LEVELS, HINT_PENALTY_MIN, GAME_TITLE: 'The Greywater Light' };
