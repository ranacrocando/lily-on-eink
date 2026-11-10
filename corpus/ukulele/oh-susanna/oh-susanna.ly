\version "2.24.0"
% lily-on-eink test corpus, CC0 1.0 Universal (public domain dedication).
% Original ukulele song sheet written for this corpus. Melody: Stephen Foster,
% "Oh! Susanna" (1848; composer died 1864, public domain). Lyrics: the traditional
% public domain text. Chords and arrangement are our own.
% Exercises: ChordNames, FretBoards with predefined-ukulele-fretboards.ly, TabStaff with
% ukulele-tuning, lyrics in two stanzas, volta repeat, pickup measure.

\include "predefined-ukulele-fretboards.ly"

\header {
  title = "Oh! Susanna"
  subtitle = "Song sheet for ukulele (GCEA)"
  composer = "Stephen Foster (1826–1864)"
  arranger = "Arr.: lily-on-eink test corpus"
  tagline = "CC0 1.0 – public domain dedication"
}

global = {
  \key c \major
  \time 4/4
  \tempo "Lively" 4 = 120
}

melody = \relative c' {
  \global
  \partial 4 c8 d |
  \repeat volta 2 {
    e4 g g a8 g | e8 e d c d c d4 |
    c8 d e4 g g | a8 g e c d4 d |
    d8 e e d d4 c4 |
  }
}

harmonies = \chordmode {
  \partial 4 c4 |
  c1 | c2 g:7 |
  c1 | f2 c |
  g2.:7 c4 |
}

verseOne = \lyricmode {
  I come
  from A -- la -- ba -- ma with my ban -- jo on my knee,
  I'm go -- ing to Lou -- i -- si -- an -- a, my true love for to see.
}

verseTwo = \lyricmode {
  It rained
  all night the day I left, the weath -- er it was dry,
  The sun so hot I froze to death, Su -- san -- na, don't you cry.
}

\score {
  <<
    \new ChordNames \with { chordChanges = ##t } \harmonies
    \new FretBoards \with {
      \override FretBoard.size = #'1.0
      chordChanges = ##t
    } {
      \set Staff.stringTunings = #ukulele-tuning
      \harmonies
    }
    \new Staff = "melody" <<
      \new Voice = "tune" { \melody }
      \new Lyrics \lyricsto "tune" { \set stanza = "1." \verseOne }
      \new Lyrics \lyricsto "tune" { \set stanza = "2." \verseTwo }
    >>
    \new TabStaff \with {
      stringTunings = #ukulele-tuning
    } \melody
  >>
  \layout { }
}
