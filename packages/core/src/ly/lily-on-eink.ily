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

% Device settings, set by the wrapper before the user's file: an alist with paper-width,
% paper-height, top-margin, bottom-margin, left-margin and right-margin in mm, staff-size in
% pt and keep-tagline (a boolean). #f: not configured.
#(define lily-on-eink:device #f)
#(define (lily-on-eink:configure! settings) (set! lily-on-eink:device settings))
#(define (lily-on-eink:keep-tagline?)
   (or (not lily-on-eink:device) (assq-ref lily-on-eink:device 'keep-tagline)))

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
smaller) on the very last page of the book unless the device settings drop it; both wrapped
or scaled to the line width."
   (let* ((width (lily-on-eink:available-width layout props))
          (copyright
           (if (lily-on-eink:part-first-page? layout props)
               (interpret-markup layout props (make-lily-on-eink-field-markup 'header:copyright))
               empty-stencil))
          (tagline
           (if (and (lily-on-eink:keep-tagline?) (lily-on-eink:book-last-page? layout props))
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

% --- Top-level markup that fits the page width ----------------------------------------------
% Every top-level \markup and \markuplist (also inside \book and \bookpart) is handed to
% LilyPond wrapped in \lily-on-eink-fit-lines, so no markup line is wider than the line width.
% A markup that fits is drawn unchanged. One that is too wide is scaled down to the line
% width; if that would shrink it below lily-on-eink:min-scale, its \line and \fill-line parts
% are first reflowed into rows (side-by-side verses become one column), and the result is
% scaled only if it is still too wide.

% Smallest scale factor before reflowing is tried; below this, text gets hard to read.
#(define lily-on-eink:min-scale 0.7)

% Moves a stencil so that its left edge is at X = 0.
#(define (lily-on-eink:flush-left stil)
   (if (ly:stencil-empty? stil X)
       stil
       (ly:stencil-translate-axis stil (- (car (ly:stencil-extent stil X))) X)))

% Scales a stencil that is wider than @var{width} down to it, flush left (it then fills the
% line, so centred and flush-left placement coincide). A stencil that fits is not moved.
#(define (lily-on-eink:fit-stencil stil width)
   (if (> (lily-on-eink:width stil) width)
       (lily-on-eink:flush-left (lily-on-eink:shrink-to stil width))
       stil))

#(define (lily-on-eink:height stil)
   (if (ly:stencil-empty? stil Y) 0 (interval-length (ly:stencil-extent stil Y))))

% Puts @var{right} to the right of @var{left}, @var{gap} apart.
#(define (lily-on-eink:beside left right gap)
   (ly:stencil-combine-at-edge left X RIGHT right gap))

% Joins items so that a row break never separates them: an item without height (an
% \hspace) with the item after it, then an item followed by a much taller item (a verse
% number before its verse) with that item. A trailing item without height is dropped.
#(define (lily-on-eink:glue-labels stils gap)
   (let ((spaced
          (let loop ((rest stils) (done '()))
            (cond
             ((null? rest) (reverse done))
             ((ly:stencil-empty? (car rest) Y)
              (if (pair? (cdr rest))
                  (loop (cons (lily-on-eink:beside (car rest) (cadr rest) gap) (cddr rest)) done)
                  (loop (cdr rest) done)))
             (else (loop (cdr rest) (cons (car rest) done)))))))
     (let loop ((rest spaced) (done '()))
       (cond
        ((null? rest) (reverse done))
        ((and (pair? (cdr rest))
              (> (lily-on-eink:height (cadr rest)) (* 1.5 (lily-on-eink:height (car rest)))))
         (loop (cddr rest) (cons (lily-on-eink:beside (car rest) (cadr rest) gap) done)))
        (else (loop (cdr rest) (cons (car rest) done)))))))

% Stacks stencils top down, flush left, @var{gap} apart (ink extents).
#(define (lily-on-eink:stack-flush-left stils gap)
   (fold (lambda (next above)
           (ly:stencil-combine-at-edge above Y DOWN (lily-on-eink:flush-left next) gap))
         (lily-on-eink:flush-left (car stils))
         (cdr stils)))

% Splits stencils into rows (lists) that fit @var{width} with @var{gap} between items (first
% fit). An item wider than the line gets a row of its own.
#(define (lily-on-eink:split-rows stils width gap)
   (let loop ((rest stils) (row '()) (row-width 0) (rows '()))
     (cond
      ((null? rest) (reverse (if (null? row) rows (cons (reverse row) rows))))
      ((null? row)
       (loop (cdr rest) (list (car rest)) (lily-on-eink:width (car rest)) rows))
      (else
       (let ((longer (+ row-width gap (lily-on-eink:width (car rest)))))
         (if (<= longer width)
             (loop (cdr rest) (cons (car rest) row) longer rows)
             (loop rest '() 0 (cons (reverse row) rows))))))))

% Places the items of one row at the given X offsets, flush left each.
#(define (lily-on-eink:row-at stils offsets)
   (fold (lambda (stil x row)
           (ly:stencil-add row (ly:stencil-translate-axis (lily-on-eink:flush-left stil) x X)))
         empty-stencil stils offsets))

% Lays out stencils left to right in rows that fit @var{width} (first fit), @var{gap} apart;
% rows are stacked top down, @var{row-gap} apart. When every row has the same number of items
% and a common column grid fits the line, the items are aligned in columns.
#(define (lily-on-eink:rows stils width gap row-gap)
   (let* ((rows (lily-on-eink:split-rows stils width gap))
          (count (if (pair? rows) (length (car rows)) 0))
          (columns (and (> count 1) (pair? (cdr rows))
                        (every (lambda (row) (= count (length row))) rows)
                        (apply map (lambda column (apply max (map lily-on-eink:width column)))
                               rows)))
          (offsets (and columns
                        (reverse (cdr (fold (lambda (w acc) (cons (+ (car acc) w gap) acc))
                                            '(0) columns)))))
          (grid? (and columns (<= (+ (apply + columns) (* gap (1- count))) width))))
     (if (null? rows)
         empty-stencil
         (lily-on-eink:stack-flush-left
          (map (lambda (row)
                 (lily-on-eink:row-at
                  row
                  (if grid?
                      offsets
                      (reverse (cdr (fold (lambda (s acc)
                                            (cons (+ (car acc) (lily-on-eink:width s) gap) acc))
                                          '(0) row))))))
               rows)
          row-gap))))

#(define-markup-command (lily-on-eink-flow layout props original items) (markup? markup-list?)
   "Draws @var{original} when it fits the line width. Otherwise draws @var{items} left to
right in rows that fit the line width, keeping an item that is followed by a much taller one
(a verse number before its verse) on the row of that one."
   (let ((width (lily-on-eink:available-width layout props))
         (stil (interpret-markup layout props original)))
     (if (<= (lily-on-eink:width stil) width)
         stil
         (let ((gap (chain-assoc-get 'word-space props 0.6))
               (skip (chain-assoc-get 'baseline-skip props 3))
               (stils (remove (lambda (s) (ly:stencil-empty? s X))
                              (interpret-markup-list layout props items))))
           ;; Items side by side get a wider gap than a label and its item, so that two
           ;; verses on one row read as two columns.
           (lily-on-eink:rows (lily-on-eink:glue-labels stils gap) width (* 4 gap) (/ skip 2))))))

% A copy of markup @var{m} in which every \line and \fill-line, at any depth, becomes a
% \lily-on-eink-flow: drawn as before where it fits, in rows where it does not.
#(define (lily-on-eink:flowing m)
   (cond
    ((not (and (pair? m) (markup? m))) m)
    ((memq (car m) (list line-markup fill-line-markup))
     (make-lily-on-eink-flow-markup m (map lily-on-eink:flowing (cadr m))))
    (else
     (cons (car m)
           (map (lambda (arg)
                  (cond
                   ((markup? arg) (lily-on-eink:flowing arg))
                   ((and (pair? arg) (markup-list? arg)) (map lily-on-eink:flowing arg))
                   (else arg)))
                (cdr m))))))

#(define-markup-command (lily-on-eink-fit layout props arg) (markup?)
   "Draws @var{arg} unchanged when it fits the line width. Otherwise scales it down to the
line width; when that would scale it below @code{lily-on-eink:min-scale}, its line layouts
are reflowed into rows first."
   (let* ((width (lily-on-eink:available-width layout props))
          (stil (interpret-markup layout props arg))
          (w (lily-on-eink:width stil)))
     (cond
      ((<= w width) stil)
      ((>= (/ width w) lily-on-eink:min-scale) (lily-on-eink:fit-stencil stil width))
      (else
       (let ((flowed (interpret-markup layout props (lily-on-eink:flowing arg))))
         (lily-on-eink:fit-stencil (if (< (lily-on-eink:width flowed) w) flowed stil) width))))))

#(define-markup-list-command (lily-on-eink-fit-lines layout props args) (markup-list?)
   "The lines of @var{args}, none wider than the line width: each markup goes through
@code{\\lily-on-eink-fit}; each line of a markup list command is scaled down if too wide."
   (let ((width (lily-on-eink:available-width layout props)))
     (append-map
      (lambda (m)
        (if (markup? m)
            (list (interpret-markup layout props (make-lily-on-eink-fit-markup m)))
            (map (lambda (s) (lily-on-eink:fit-stencil s width))
                 (interpret-markup-list layout props (list m)))))
      args)))

% LilyPond passes every top-level text (a \markup arrives as a list of one) to one of these
% handlers. The originals are kept under our own names and called with the fitted text.
#(define lily-on-eink:toplevel-text-handler toplevel-text-handler)
#(define lily-on-eink:book-text-handler book-text-handler)
#(define lily-on-eink:bookpart-text-handler bookpart-text-handler)
#(define (lily-on-eink:fitted text) (make-lily-on-eink-fit-lines-markup-list text))
#(define (toplevel-text-handler text)
   (lily-on-eink:toplevel-text-handler (lily-on-eink:fitted text)))
#(define (book-text-handler book text)
   (lily-on-eink:book-text-handler book (lily-on-eink:fitted text)))
#(define (bookpart-text-handler book text)
   (lily-on-eink:bookpart-text-handler book (lily-on-eink:fitted text)))

% --- The device paper, also inside \book and \bookpart ---------------------------------------
% The wrapper's \paper block after the user's file only reaches the default paper. A \book is
% printed as soon as it is read, with the paper it had then, and a \paper inside a \book or
% \bookpart replaces paper size, margins and staff size for that book. So every book, the
% implicit one at the end of the file included, passes through the book handler below, which
% writes the device settings into the paper of the book and of each of its book parts, after
% everything the user's file set. Other paper settings (fonts, spacing) are kept.

% Vertical fill of pages that are not the last one. With ragged-bottom = #f, LilyPond
% stretches the flexible spacings of a page until its last system reaches the bottom margin,
% sharing the free space by stretchability: between the systems (system-system-spacing, 60 by
% default) and below the last one (last-bottom-spacing, 30). A page with few tall systems (a
% song sheet with chord diagrams, tab and lyrics: two systems per page) then puts all its free
% space into one or two gaps. The overlay makes the space below the last system as stretchable
% as lily-on-eink:bottom-stretch-gaps system gaps. Free space therefore goes mostly into the
% gaps on a page with many systems (the page still looks filled; there is little free space
% anyway) and mostly below the last system on a page with few systems (no huge gaps). A page
% without free space is not stretched, so its spacing does not change. A larger bottom
% stretchability set by the user is kept; a smaller one is raised. Stretchability also enters
% LilyPond's page-breaking penalties, so page breaks could in principle change (none did on
% the corpus).
#(define lily-on-eink:bottom-stretch-gaps 4)

#(define (lily-on-eink:limit-fill! paper)
   (let* ((stretch (lambda (key)
                     (let ((v (assq-ref (ly:output-def-lookup paper key '()) 'stretchability)))
                       (if (number? v) v 0))))
          (wanted (* lily-on-eink:bottom-stretch-gaps (stretch 'system-system-spacing))))
     (if (> wanted (stretch 'last-bottom-spacing))
         (ly:output-def-set-variable!
          paper 'last-bottom-spacing
          (acons 'stretchability wanted
                 (alist-delete 'stretchability (ly:output-def-lookup paper 'last-bottom-spacing '())))))))

#(define (lily-on-eink:apply-device! paper)
   (let* ((ref (lambda (key) (assq-ref lily-on-eink:device key)))
          (set (lambda (key value) (ly:output-def-set-variable! paper key value)))
          (mm (ly:output-def-lookup paper 'mm 1))
          (staff-height (* (ref 'staff-size) (ly:output-def-lookup paper 'pt))))
     ;; Re-applied only when it differs: it also resets the paper's font sizes.
     (if (> (abs (- staff-height (ly:output-def-lookup paper 'staff-height 0))) 1e-6)
         (layout-set-absolute-staff-size-in-module (ly:output-def-scope paper) staff-height))
     (for-each (lambda (key) (set key (* mm (ref key))))
               '(paper-width paper-height top-margin bottom-margin left-margin right-margin))
     (set 'line-width (* mm (- (ref 'paper-width) (ref 'left-margin) (ref 'right-margin))))
     ;; One-sided and upright, so the four margins above are the ones used.
     (set 'two-sided #f)
     (set 'landscape #f)
     (set 'ragged-last-bottom #t)
     (lily-on-eink:limit-fill! paper)
     (set 'print-page-number #f)
     (set 'bookTitleMarkup lilyOnEinkBookTitleMarkup)
     (set 'scoreTitleMarkup lilyOnEinkScoreTitleMarkup)
     (set 'oddHeaderMarkup lilyOnEinkPageHeaderMarkup)
     (set 'evenHeaderMarkup lilyOnEinkPageHeaderMarkup)
     (set 'oddFooterMarkup lilyOnEinkFooterMarkup)
     (set 'evenFooterMarkup lilyOnEinkFooterMarkup)))

% --- Instrument names inside the margin ---
% LilyPond draws instrument names to the left of the system start, in the space that indent
% (first system) and short-indent (later systems) leave free, with the brackets and braces of
% staff groups between the names and the staves. A name wider than that space runs into the
% margin and off the page. The book handler therefore collects the names from the music of
% each score, measures them, and widens indent or short-indent of that score's layout where
% needed. It never narrows them, and scores without names are not touched.

% Room between a name and the staves, in mm, without staff groups ...
#(define lily-on-eink:name-padding-mm 1.5)
% ... and per nesting level of staff groups (one bracket or brace each), in staff spaces.
#(define lily-on-eink:group-allowance 2)

% Context types that draw a bracket or brace at the system start. Any type whose name
% contains "Group" counts as well.
#(define lily-on-eink:group-types
   '(StaffGroup ChoirStaff PianoStaff GrandStaff InnerStaffGroup InnerChoirStaff))

#(define (lily-on-eink:group? m)
   (and (eq? 'ContextSpeccedMusic (ly:music-property m 'name))
        (let ((type (ly:music-property m 'context-type)))
          (and (symbol? type)
               (or (memq type lily-on-eink:group-types)
                   (string-contains (symbol->string type) "Group"))))))

#(define (lily-on-eink:children m)
   (append (filter ly:music? (ly:music-property m 'elements))
           (let ((e (ly:music-property m 'element))) (if (ly:music? e) (list e) '()))))

% The values of @var{property} (instrumentName or shortInstrumentName) found in @var{music}:
% in \set commands and in the \with blocks of \new and \context.
#(define (lily-on-eink:name-values music property)
   (let walk ((m music))
     (append
      (if (and (eq? 'PropertySet (ly:music-property m 'name))
               (eq? property (ly:music-property m 'symbol)))
          (list (ly:music-property m 'value))
          '())
      (filter-map (lambda (op)
                    (and (pair? op) (eq? 'assign (car op)) (pair? (cdr op))
                         (eq? property (cadr op)) (pair? (cddr op))
                         (caddr op)))
                  (let ((ops (ly:music-property m 'property-operations)))
                    (if (list? ops) ops '())))
      (append-map walk (lily-on-eink:children m)))))

% The deepest nesting of staff groups in @var{music}.
#(define (lily-on-eink:group-depth music)
   (let walk ((m music))
     (+ (if (lily-on-eink:group? m) 1 0)
        (fold max 0 (map walk (lily-on-eink:children m))))))

% Width in mm of the widest @var{property} value in @var{music}, measured with the text
% settings of @var{paper}. Markup stencils are in staff spaces; output-scale is the staff
% space in mm.
#(define (lily-on-eink:widest-name-mm paper music property)
   (let ((props (layout-extract-page-properties paper))
         (scale (ly:output-def-lookup paper 'output-scale 1)))
     (fold max 0
           (map (lambda (value)
                  (* scale (lily-on-eink:width (interpret-markup paper props value))))
                (filter markup? (lily-on-eink:name-values music property))))))

% The \layout definitions of @var{score}. A score without any output definition is laid out
% with the default \layout, so it gets a copy of that to change. A score with only \midi has
% none and is not laid out.
#(define (lily-on-eink:score-layouts! score)
   (let ((defs (ly:score-output-defs score)))
     (if (null? defs)
         (let ((def (ly:output-def-clone (ly:parser-lookup '$defaultlayout))))
           (ly:score-add-output-def! score def)
           (list def))
         (filter (lambda (def) (eq? 'layout (ly:output-def-lookup def 'output-def-kind)))
                 defs))))

% Widens indent and short-indent of @var{score}'s layout so that its instrument names fit.
% A layout that does not set them falls back to @var{paper}'s values.
#(define (lily-on-eink:fit-names! paper score)
   (let* ((music (ly:score-music score))
          (widths (map (lambda (property) (lily-on-eink:widest-name-mm paper music property))
                       '(instrumentName shortInstrumentName))))
     (if (any positive? widths)
         (let ((room (+ lily-on-eink:name-padding-mm
                        (* lily-on-eink:group-allowance
                           (lily-on-eink:group-depth music)
                           (ly:output-def-lookup paper 'output-scale 1)))))
           (for-each
            (lambda (def)
              (for-each
               (lambda (variable width)
                 (if (positive? width)
                     (let ((needed (* (+ width room) (ly:output-def-lookup def 'mm 1))))
                       (if (< (ly:output-def-lookup def variable
                                                    (ly:output-def-lookup paper variable 0))
                              needed)
                           (ly:output-def-set-variable! def variable needed)))))
               '(indent short-indent)
               widths))
            (lily-on-eink:score-layouts! score))))))

% Applies the device settings to the paper of @var{book} and of all its book parts, and fits
% the instrument names of their scores.
#(define (lily-on-eink:apply-device-to-book! book)
   (let ((paper (ly:book-paper book)))
     (if (ly:output-def? paper)
         (begin
           (lily-on-eink:apply-device! paper)
           (for-each (lambda (score) (lily-on-eink:fit-names! paper score))
                     (filter ly:score? (ly:book-scores book))))))
   (for-each lily-on-eink:apply-device-to-book! (ly:book-book-parts book)))

#(define lily-on-eink:toplevel-book-handler toplevel-book-handler)
#(define (toplevel-book-handler book)
   (if lily-on-eink:device (lily-on-eink:apply-device-to-book! book))
   (lily-on-eink:toplevel-book-handler book))

% Output file names: the engine always writes score.pdf, score-1.pdf, ...; a book's own
% output name or suffix would make its PDF unfindable, so these commands do nothing here.
bookOutputName = #(define-void-function (name) (string?) *unspecified*)
bookOutputSuffix = #(define-void-function (suffix) (string?) *unspecified*)
