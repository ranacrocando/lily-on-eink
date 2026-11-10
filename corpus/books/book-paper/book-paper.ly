\version "2.24.0"
% lily-on-eink test fixture: a \book with its own \paper block.
% Original music written for the lily-on-eink test corpus.
% License: CC0 1.0 Universal (public domain dedication).
% Exercises: paper size and margins set inside \book (A4 with wide margins), which the
% device page must replace.

melody = \relative c'' {
  \time 4/4
  \repeat unfold 6 { c4 d e f | g2 g | a4 f e d | c1 | }
  \bar "|."
}

\book {
  \paper {
    paper-width = 210\mm
    paper-height = 297\mm
    top-margin = 25\mm
    bottom-margin = 25\mm
    left-margin = 30\mm
    right-margin = 30\mm
  }
  \header {
    title = "Paper in a Book"
    composer = "lily-on-eink test corpus"
  }
  \score { \new Staff \melody }
}
