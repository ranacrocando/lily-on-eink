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

% Splits a string into lines that fit @var{width} (first fit, word by word), measured with the
% current fonts. It splits at ASCII spaces (U+0020) only: tabs, newlines and no-break spaces
% stay inside a word. A single word wider than the line keeps a line of its own.
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
   (lily-on-eink:pair layout props left right))

#(define (lily-on-eink:pair layout props left right)
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

% Places @var{lower} below @var{upper}, @var{gap} apart (ink extents, not baselines). Either
% may be empty; the result keeps the full line as X extent.
#(define (lily-on-eink:above upper lower gap width)
   (cond
    ((ly:stencil-empty? lower) upper)
    ((ly:stencil-empty? upper) lower)
    (else
     (let ((both (ly:stencil-combine-at-edge upper Y DOWN lower gap)))
       (ly:make-stencil (ly:stencil-expr both) (cons 0 width) (ly:stencil-extent both Y))))))

% Space between the stacked parts of the score title and of the footer, in staff spaces.
#(define lily-on-eink:part-gap 1)

#(define-markup-command (lily-on-eink-score-title layout props) ()
   "Title of one score: the piece/opus pair. When the paper sets @code{print-all-headers}
to true, each score repeats the full title block (the paper's @code{bookTitleMarkup},
interpreted with this score's header) above that pair, @code{lily-on-eink:part-gap}
staff spaces apart."
   (let* ((width (lily-on-eink:available-width layout props))
          (pair (lily-on-eink:pair layout props 'header:piece 'header:opus))
          (full-title? (eq? #t (ly:output-def-lookup layout 'print-all-headers #f)))
          (book-markup (and full-title? (ly:output-def-lookup layout 'bookTitleMarkup #f)))
          (book (if (markup? book-markup)
                    (lily-on-eink:shrink-to (interpret-markup layout props book-markup) width)
                    empty-stencil)))
     (lily-on-eink:above book pair lily-on-eink:part-gap width)))

% Page facts for header and footer markups. The page properties are set by LilyPond's page
% layout; first-page-number comes from the paper (it is the first page of the book part).
#(define (lily-on-eink:part-first-page? layout props)
   (let ((page (chain-assoc-get 'page:page-number props #f)))
     (and (number? page)
          (= page (ly:output-def-lookup layout 'first-page-number 1)))))

#(define (lily-on-eink:book-last-page? layout props)
   (and (eq? #t (chain-assoc-get 'page:is-bookpart-last-page props #f))
        (eq? #t (chain-assoc-get 'page:is-last-bookpart props #f))))

#(define-markup-command (lily-on-eink-footer layout props) ()
   "Page footer: the copyright on the first page of each book part, the tagline (one size
smaller) on the very last page of the book; both wrapped or scaled to the line width."
   (let* ((width (lily-on-eink:available-width layout props))
          (copyright
           (if (lily-on-eink:part-first-page? layout props)
               (interpret-markup layout props (make-lily-on-eink-field-markup 'header:copyright))
               empty-stencil))
          (tagline
           (if (lily-on-eink:book-last-page? layout props)
               (interpret-markup layout (cons '((font-size . -1)) props)
                                 (make-lily-on-eink-field-markup 'header:tagline))
               empty-stencil)))
     (lily-on-eink:above copyright tagline lily-on-eink:part-gap width)))

#(define-markup-command (lily-on-eink-page-header layout props) ()
   "Page header: the instrument name, wrapped or scaled to the line width, on every page of a
book part except its first (where the title block shows it). No page numbers."
   (if (lily-on-eink:part-first-page? layout props)
       empty-stencil
       (interpret-markup layout props (make-lily-on-eink-field-markup 'header:instrument))))

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

lilyOnEinkScoreTitleMarkup = \markup \lily-on-eink-score-title
lilyOnEinkFooterMarkup = \markup \lily-on-eink-footer
lilyOnEinkPageHeaderMarkup = \markup \lily-on-eink-page-header
