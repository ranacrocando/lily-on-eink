% lily-on-eink overlay (slice). MIT. Neutralises manual layout before the user's file is read.
break = {}
noBreak = {}
autoBreaksOff = {}
autoLineBreaksOff = {}
autoPageBreaksOff = {}
% Page-marker commands are legal at top level; return a neutral page marker instead of {}.
#(define (lily-on-eink:neutral-page-marker)
   (make-music 'EventChord 'page-marker #t 'elements '()))
pageBreak = #(define-music-function () () (lily-on-eink:neutral-page-marker))
noPageBreak = #(define-music-function () () (lily-on-eink:neutral-page-marker))
pageTurn = #(define-music-function () () (lily-on-eink:neutral-page-marker))
noPageTurn = #(define-music-function () () (lily-on-eink:neutral-page-marker))
allowPageTurn = #(define-music-function () () (lily-on-eink:neutral-page-marker))

% --- Titles that fit the page width ---------------------------------------------------------
% Header fields are wrapped (strings) or scaled down (markups) to the line width. The markups
% below are only definitions; the wrapper's final \paper block installs them, so they replace
% whatever title markups the user's file set.

% Width available to a title markup: the props value if one is set, else the paper line width.
#(define (lily-on-eink:available-width layout props)
   (let ((w (chain-assoc-get 'line-width props #f)))
     (if (number? w) w (ly:output-def-lookup layout 'line-width))))

#(define (lily-on-eink:width stil)
   (if (ly:stencil-empty? stil X) 0 (interval-length (ly:stencil-extent stil X))))

% Scales a stencil down uniformly when it is wider than @var{width}.
#(define (lily-on-eink:shrink-to stil width)
   (let ((w (lily-on-eink:width stil)))
     (if (> w width)
         (ly:stencil-scale stil (/ width w) (/ width w))
         stil)))

% Puts a stencil at the left edge, the centre or the right edge of [0, width].
#(define (lily-on-eink:place stil width dir)
   (if (ly:stencil-empty? stil X)
       stil
       (ly:stencil-translate-axis (ly:stencil-aligned-to stil X dir)
                                  (* width (/ (+ dir 1) 2))
                                  X)))

% Splits a string at spaces into lines that fit @var{width} (first fit, word by word), measured
% with the current fonts. A single word wider than the line keeps a line of its own.
#(define (lily-on-eink:wrap-string layout props str width)
   (let ((render (lambda (s) (interpret-markup layout props s))))
     (let loop ((words (filter (lambda (w) (not (string-null? w))) (string-split str #\space)))
                (current #f)
                (done '()))
       (cond
        ((null? words)
         (reverse (if current (cons (render current) done) done)))
        ((not current)
         (loop (cdr words) (car words) done))
        (else
         (let ((longer (string-append current " " (car words))))
           (if (<= (lily-on-eink:width (render longer)) width)
               (loop (cdr words) longer done)
               (loop (cdr words) (car words) (cons (render current) done)))))))))

% The lines of a header value, each no wider than @var{width}.
#(define (lily-on-eink:value-lines layout props value width)
   (map (lambda (stil) (lily-on-eink:shrink-to stil width))
        (cond
         ((string? value) (lily-on-eink:wrap-string layout props value width))
         ((markup? value) (list (interpret-markup layout props value)))
         (else '()))))

% Stacks the non-empty lines top down and gives the result the full line as X extent.
% The origin is on the LAST line's baseline: an enclosing \column places the next field
% baseline-skip below its origin, so a wrapped field is followed exactly like a one-line
% field. Above a wrapped field, a quarter baseline-skip of padding keeps it off the field
% before (which is placed by extent, not by baseline, once the block is tall).
#(define (lily-on-eink:stack props lines width)
   (let ((lines (filter (lambda (s) (not (ly:stencil-empty? s))) lines))
         (skip (chain-assoc-get 'baseline-skip props 3)))
     (if (null? lines)
         empty-stencil
         (let* ((column (stack-lines UP 0 skip (reverse lines)))
                (y (ly:stencil-extent column Y))
                (pad (if (null? (cdr lines)) 0 (/ skip 4))))
           (ly:make-stencil (ly:stencil-expr column)
                            (cons 0 width)
                            (cons (car y) (+ (cdr y) pad)))))))

#(define-markup-command (lily-on-eink-field layout props field) (symbol?)
   "Header field @var{field}: a string is wrapped into centred lines that fit the line
width; a markup wider than the line is scaled down to fit and centred."
   (let ((width (lily-on-eink:available-width layout props)))
     (lily-on-eink:stack
      props
      (map (lambda (stil) (lily-on-eink:place stil width CENTER))
           (lily-on-eink:value-lines layout props (chain-assoc-get field props #f) width))
      width)))

#(define-markup-command (lily-on-eink-field-pair layout props left right) (symbol? symbol?)
   "Header fields @var{left} (flush left) and @var{right} (flush right) on one line when
both fit side by side, else stacked, each wrapped or scaled like @code{lily-on-eink-field}."
   (let* ((width (lily-on-eink:available-width layout props))
          (gap (* 4 (chain-assoc-get 'word-space props 0.6)))
          (left-lines (lily-on-eink:value-lines layout props (chain-assoc-get left props #f) width))
          (right-lines (lily-on-eink:value-lines layout props (chain-assoc-get right props #f) width))
          (flush-left (map (lambda (s) (lily-on-eink:place s width LEFT)) left-lines))
          (flush-right (map (lambda (s) (lily-on-eink:place s width RIGHT)) right-lines)))
     (if (and (= 1 (length left-lines))
              (= 1 (length right-lines))
              (<= (+ (lily-on-eink:width (car left-lines)) gap (lily-on-eink:width (car right-lines)))
                  width))
         (lily-on-eink:stack props (list (ly:stencil-add (car flush-left) (car flush-right))) width)
         (lily-on-eink:stack props (append flush-left flush-right) width))))

#(define (lily-on-eink:print-all-headers? layout props)
   (eq? #t (ly:output-def-lookup layout 'print-all-headers)))

#(define (lily-on-eink:first-page-of-part? layout props)
   (eqv? (chain-assoc-get 'page:page-number props -1)
         (ly:output-def-lookup layout 'first-page-number)))

#(define (lily-on-eink:last-page-of-book? layout props)
   (and (chain-assoc-get 'page:is-bookpart-last-page props #f)
        (chain-assoc-get 'page:is-last-bookpart props #f)
        #t))

% The title is two font-size steps below LilyPond's A4 default (\huge instead of
% \huge \larger \larger): on a page about 12 cm wide the A4 size wraps most titles and
% costs a page turn, and it still sits above the subtitle (\large) in size.
lilyOnEinkBookTitleMarkup = \markup {
  \override #'(baseline-skip . 3.5)
  \column {
    \lily-on-eink-field #'header:dedication
    \huge \bold \lily-on-eink-field #'header:title
    \large \bold \lily-on-eink-field #'header:subtitle
    \smaller \bold \lily-on-eink-field #'header:subsubtitle
    \large \bold \lily-on-eink-field #'header:instrument
    \lily-on-eink-field-pair #'header:poet #'header:composer
    \lily-on-eink-field-pair #'header:meter #'header:arranger
  }
}

lilyOnEinkScoreTitleMarkup = \markup {
  \column {
    \if #lily-on-eink:print-all-headers? { \lilyOnEinkBookTitleMarkup \hspace #1 }
    \lily-on-eink-field-pair #'header:piece #'header:opus
  }
}

lilyOnEinkFooterMarkup = \markup {
  \column {
    \if #lily-on-eink:first-page-of-part? \lily-on-eink-field #'header:copyright
    \if #lily-on-eink:last-page-of-book? \small \lily-on-eink-field #'header:tagline
  }
}
