\version "2.24.0"
% lily-on-eink test corpus, CC0 1.0 Universal (public domain dedication).
% Original accordion arrangement written for this corpus. Melody: the traditional German
% children's song "Alle meine Entchen" (folk tune, public domain).
% Exercises: treble staff with register marks (boxed markup; the discant markup is not
% available in this engine), Stradella bass notation (bass and chord buttons), chord names,
% dynamics, volta repeat, staccato.

\header {
  title = "Alle meine Entchen"
  subtitle = "Für Akkordeon (Standardbass)"
  composer = "Volksweise"
  arranger = "Arr.: lily-on-eink test corpus"
  tagline = "CC0 1.0 – public domain dedication"
}

global = {
  \key c \major
  \time 4/4
  \tempo "Im Marschtempo" 4 = 112
}

chordNamesMusic = \chordmode {
  c1 | c1 | f1 | c1 |
  f1 | c1 | f1 | c1 |
  g1:7 | c1 |
}

% Right hand, plain melody
rightA = \relative c' {
  c4 d e f | g2 g | a4 a a a | g1 |
  a4 a a a | g1 | f4 f f f | e2 e |
  d4 d d d | c1 |
}

% Right hand, repeat with a lower third in the second half
rightB = \relative c' {
  c4 d e f | g2 g | <c, a'>4 q q q | g'1 |
  <c, a'>4 q q q | g'1 | <c, f>4 q q q | e2 e |
  <b d>4 q q q | <g c>1 |
}

% Left hand, bass and chord buttons: oom-pah
bassC = { c,4 <e g c>-. g,4 <e g c>-. }
bassF = { f,4 <f a c'>-. c4 <f a c'>-. }
bassG = { g,4 <f b d'>-. d4 <f b d'>-. }

left = {
  \clef bass
  \bassC | \bassC | \bassF | \bassC |
  \bassF | \bassC | \bassF | \bassC |
  \bassG | \bassC |
}

\score {
  <<
    \new ChordNames \chordNamesMusic
    \new PianoStaff <<
      \new Staff = "right" {
        \global
        \clef treble
        \mark \markup { \box \bold "Master" }
        \repeat volta 2 { \rightA }
        \mark \markup { \box \bold "Violin" }
        \rightB
        \bar "|."
      }
      \new Dynamics { s1\mf s1*9 s1\f s1*9 }
      \new Staff = "left" {
        \global
        \clef bass
        \repeat volta 2 { \left }
        \left
      }
    >>
  >>
  \layout { }
}
