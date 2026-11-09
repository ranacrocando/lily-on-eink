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
