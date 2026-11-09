\version "2.24.0" % Specify the version of LilyPond
#(set-default-paper-size "a4" 'landscape)
% this is based on https://imslp.org/wiki/30_Kleine_Choralvorspiele,_Op.135a_%28Reger,_Max%29
% https://imslp.org/wiki/Special:ReverseLookup/201428 page 15
% licensed under the Creative Commons CC0 1.0 Universal Public Domain Dedication
% sources: https://github.com/ranacrocando/lilypond-scores/blob/main/max-reger-lobe-den-herren/

\header {
  title = "Lobe den Herren, den mächtigen König der Ehren."
  composer = "Max Reger (1873-1916)"
  subtitle="Dreissig kleine Choral-Vorspiele – Opus 135A Nr. 15 "
  %piece="Lebhaft"
  tagline = \markup {
    \override #'(font-size . -4)
    \center-align {
      \column {
        \line {
          \bold "This work is dedicated to the public domain under the Creative Commons Zero (CC0) license."
        }
        \line {
          Based on
          \with-url
          #"https://imslp.org/wiki/Special:ReverseLookup/201428"
          "C.F. Peters Leipzig (1915)"
        }
      }
    }
  }
}


global = {
  \key g \major
  \time 3/2
}

melodyVoice = \relative c'' {
  \clef treble
  \key g \major
  \time 3/2
  \stemUp \slurUp
  g2^- \f ( g^- d'
  b a g
  fis
  e d
  e fis g
  a1.
  g\parenthesize\fermata )\break

  g2^--\markup{\italic "più"}\f( g^- d'
  b a g
  fis e d
  e fis g
  a1.
  g\parenthesize\fermata)

  d'2^--\markup{\italic "sempre più"}\f( d^- d^-\break
  e1.\parenthesize\fermata)
  b2( c d^-
  d^- c b
  a1.\parenthesize\fermata)

  d,2( \fff e fis
  g -\markup { \italic "sempre rit." } a b
  a1.
  g\fermata)
}
bassVoice = \relative c {
  \clef bass
  \key g \major
  \time 3/2
  \slurDown
  \stemDown
  \override Tie.direction = #UP
  g'4( a b g a b
  e d c2 b4 g
  a fis g a2 gis8 a
  g2 fis 4 a c b
  a e d a' d c~
  c a b c b2)

  g4( a b g a b
  d cis d a d2
  cis b4 bes a gis8 a
  g2 a g4 e~
  e a, a'2. b8 c~
  c4 a b c b2)

  fis4( g a b  c a
  g d e fis g a
  b d e2 fis4 g
  d a2. b4 cis
  d b a4. g8 fis2)

  b,( c d4 c
  b g' fis e d f
  e g~g fis8 e fis2
  d1.\fermata)
}

harmonyVoice = \relative c'' {
  \clef treble
  \key g \major
  \time 3/2
  \stemDown
  \slurDown
  b,4 c d e fis g~
  g fis e dis d2
  cis b4 cis d2~
  d4 cis d2 e~
  e4 g fis e fis2
  e4 c d e d2

  b4 c d e fis g~
  g e fis2. e4~
  e d2 cis4 d2~
  d4 cis d c b2
  a4 g'2 fis8 e fis2
  e4 c d e d2

  d4 e fis g a fis
  e fis g a g2
  fis g4 a b2
  a g4 fis g e
  fis g fis e d2

  \change Staff = "bassStaff"
  \stemUp
  g,4 fis e c' b a
  g\glissando
  \change Staff = "melodyAndHarmonyStaff"
  \stemDown
  e' d c b d~
  d cis8 b d2. c4
  b1. \bar "|."
}



secondBassVoice = \relative c {
  \clef bass
  \key g \major
  \time 3/2
  \stemUp
  s1.*16
  s2 cis' a
}

pedalVoice = \relative c {
  \clef bass
  \key g \major
  \time 3/2
  % Your pedal notes here
  r1.
  _\f-\markup{\italic "ben marc."} e,2--(  e-- b'
  a g fis
  e d c
  cis d d'
  g,1.)

  r2 r2 _\markup{\italic "più"}_\f-\markup{\italic "sempre ben marc."} g--(
  g-- d' b
  a g fis
  e d e
  c cis d g1.)

  r1.
  _\markup{\italic "sempre più"}\f-\markup{\italic "sempre ben marc."} c2--( c-- c--
  d c b
  fis e4 d g2
  d' a d,)

  r2 r  \fff d(
  e fis g4 gis
  a2 d d,
  g1.\fermata)
}

% Define the staff system
\score {
  <<
    \new StaffGroup <<
      \new Staff = "melodyAndHarmonyStaff" <<
        \clef treble
        \new Voice = "melody" { \melodyVoice }
        \new Voice = "harmony" { \harmonyVoice }
      >>

      \new Staff = "bassStaff" <<
        \new Voice = "bass" { \bassVoice }
        \new Voice = "basstwo" { \secondBassVoice }
      >>
    >>
    \new Staff = "pedalStaff" <<
      \new Voice = "pedal" { \pedalVoice }
    >>
  >>

  % Layout block for formatting
  \layout {}
}
