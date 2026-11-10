\version "2.24.0"
% lily-on-eink test corpus, CC0 1.0 Universal (public domain dedication).
% Original piano arrangement written for this corpus. The melody is the theme from
% L. v. Beethoven, Symphony No. 9, 4th movement (composer died 1827, public domain).
% Exercises: PianoStaff, Dynamics context, hairpins, sustain pedal marks, fingering,
% thirds and octave doublings, tempo mark, key signature.

\header {
  title = "Ode an die Freude"
  subtitle = "Leichte Klavierfassung"
  composer = "Ludwig van Beethoven (1770–1827)"
  arranger = "Arr.: lily-on-eink test corpus"
  tagline = "CC0 1.0 – public domain dedication"
}

% Instrument names are deliberately omitted: a known overlay bug clips short instrument
% names on later systems at the left page edge (fixed separately; see corpus.test.ts).

global = {
  \key c \major
  \time 4/4
  \tempo "Allegro assai" 4 = 108
}

right = {
  \global
  \clef treble
  % Phrase 1: melody alone
  e''4-3 e'' f''-4 g''-5 | g'' f'' e''-3 d''-2 | c''-1 c'' d'' e''-3 | e''4.-3 d''8 d''2 |
  % Phrase 2: with a lower third
  <c''-1 e''-3>4 q <d'' f''> <e'' g''> | q <d'' f''> <c'' e''> <b' d''> |
  <a' c''>4 q <b' d''> <c'' e''> | <b' d''>4. <a' c''>8 q2 |
  \bar "||"
  % Phrase 3
  d''4-2 d'' e''-3 c''-1 | d'' e''8 f'' e''4-3 c''-1 | d'' e''8 f'' e''4-3 d''-2 | c''4-1 d'' g'2-5 |
  \bar "||"
  % Phrase 4: octaves
  <e' e''>4-\markup { \italic marcato } q <f' f''> <g' g''> | q <f' f''> <e' e''> <d' d''> |
  <c' c''>4 q <d' d''> <e' e''> | <d' d''>4. <c' c''>8 q2 \bar "|."
}

left = {
  \global
  \clef bass
  \set Staff.pedalSustainStyle = #'mixed
  % bars 1-4
  c8\sustainOn g e g c g e g | g,8\sustainOff\sustainOn d f d g, d f d |
  c8\sustainOff\sustainOn g e g c g e g | c8\sustainOff\sustainOn g e g g,8 d f d |
  % bars 5-8
  c8\sustainOff\sustainOn g e g c g e g | g,8\sustainOff\sustainOn d f d g, d f d |
  c8\sustainOff\sustainOn g e g c g e g | g,8\sustainOff\sustainOn d f d <c, c>2 |
  % bars 9-12
  g,8\sustainOff\sustainOn d f d g, d f d | c8\sustainOff\sustainOn g e g c g e g |
  c8\sustainOff\sustainOn g e g c g e g | c8\sustainOff\sustainOn g e g g,8 d f d |
  % bars 13-16
  c8\sustainOff\sustainOn g e g c g e g | g,8\sustainOff\sustainOn d f d g, d f d |
  c8\sustainOff\sustainOn g e g c g e g | g,8\sustainOff\sustainOn d f d <c, c>2\sustainOff |
}

dynamics = {
  s1\p s1*3 |
  s1\mf s1*3 |
  s1\p\< s1 s1 s1\f |
  s1 s1 s1^\markup { \italic "rit." } s1\p
}

\score {
  \new PianoStaff <<
    \new Staff = "right" \right
    \new Dynamics \dynamics
    \new Staff = "left" \left
  >>
  \layout { }
}
