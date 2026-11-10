\version "2.24.0"
% lily-on-eink test fixture: \bookpart blocks with their own \paper blocks.
% Original music written for the lily-on-eink test corpus.
% License: CC0 1.0 Universal (public domain dedication).
% Exercises: paper size and margins set inside a top-level \bookpart, and inside a
% \bookpart of a \book; the device page must replace both.

melody = \relative c'' {
  \time 4/4
  \repeat unfold 6 { c4 d e f | g2 g | a4 f e d | c1 | }
  \bar "|."
}

\bookpart {
  \paper {
    paper-width = 210\mm
    paper-height = 297\mm
    left-margin = 30\mm
    right-margin = 30\mm
  }
  \header { title = "First Part" }
  \score { \new Staff \melody }
}

\bookpart {
  \header { title = "Second Part" }
  \score { \new Staff \melody }
}

\book {
  \bookpart {
    \paper {
      paper-width = 210\mm
      paper-height = 297\mm
      left-margin = 30\mm
      right-margin = 30\mm
    }
    \header { title = "Part in a Book" }
    \score { \new Staff \melody }
  }
}
