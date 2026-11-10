\version "2.24.0"
% lily-on-eink test fixture: paper size and staff size commands inside a \book.
% Original music written for the lily-on-eink test corpus.
% License: CC0 1.0 Universal (public domain dedication).
% Exercises: set-paper-size and set-global-staff-size inside the \paper block of a \book;
% the device page and the profile's staff size must win.

melody = \relative c'' {
  \time 4/4
  \repeat unfold 6 { c4 d e f | g2 g | a4 f e d | c1 | }
  \bar "|."
}

\book {
  \paper {
    #(set-paper-size "a4")
    #(set-global-staff-size 26)
  }
  \score { \new Staff \melody }
}
