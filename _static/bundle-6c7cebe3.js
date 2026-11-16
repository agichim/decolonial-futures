/**
 * Observe how the user enters content into the comment form in order to determine whether it's a bot or not.
 *
 * Note that no actual input is being saved here, only counts and timings between events.
 */

( function() {
	// Passive event listeners are guaranteed to never call e.preventDefault(),
	// but they're not supported in all browsers.  Use this feature detection
	// to determine whether they're available for use.
	var supportsPassive = false;

	try {
		var opts = Object.defineProperty( {}, 'passive', {
			get : function() {
				supportsPassive = true;
			}
		} );

		window.addEventListener( 'testPassive', null, opts );
		window.removeEventListener( 'testPassive', null, opts );
	} catch ( e ) {}

	function init() {
		var input_begin = '';

		var keydowns = {};
		var lastKeyup = null;
		var lastKeydown = null;
		var keypresses = [];

		var modifierKeys = [];
		var correctionKeys = [];

		var lastMouseup = null;
		var lastMousedown = null;
		var mouseclicks = [];
		var mouseclickCoordinates = [];

		var mousemoveTimer = null;
		var lastMousemoveX = null;
		var lastMousemoveY = null;
		var lastMousemoveTime = null;
		var mousemoveStart = null;
		var mousemoves = [];
		var intervalsBetweenMousemovesAndClicks = [];

		var touchmoveCountTimer = null;
		var touchmoveCount = 0;

		var lastTouchEnd = null;
		var lastTouchStart = null;
		var touchEvents = [];

		var scrollCountTimer = null;
		var scrollCount = 0;

		var correctionKeyCodes = [ 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown' ];
		var modifierKeyCodes = [ 'Shift', 'CapsLock' ];

		var forms = document.querySelectorAll( 'form[method=post]' );

		for ( var i = 0; i < forms.length; i++ ) {
			var form = forms[i];

			var formAction = form.getAttribute( 'action' );

			// Ignore forms that POST directly to other domains; these could be things like payment forms.
			if ( formAction ) {
				// Check that the form is posting to an external URL, not a path.
				if ( formAction.indexOf( 'http://' ) == 0 || formAction.indexOf( 'https://' ) == 0 ) {
					if ( formAction.indexOf( 'http://' + window.location.hostname + '/' ) != 0 && formAction.indexOf( 'https://' + window.location.hostname + '/' ) != 0 ) {
						continue;
					}
				}
			}

			form.addEventListener( 'submit', function () {
				var ak_bkp = prepare_array_for_request( keypresses );
				var ak_bmc = prepare_array_for_request( mouseclicks );
				var ak_bte = prepare_array_for_request( touchEvents );
				var ak_bmm = prepare_array_for_request( mousemoves );
				var ak_bcc = prepare_array_for_request( mouseclickCoordinates );
				var ak_bibmac = intervalsBetweenMousemovesAndClicks.slice( 0, 100 ).join( ';' );

				var input_fields = {
					// When did the user begin entering any input?
					'bib': input_begin,

					// When was the form submitted?
					'bfs': Date.now(),

					// How many keypresses did they make?
					'bkpc': keypresses.length,

					// How quickly did they press a sample of keys, and how long between them?
					'bkp': ak_bkp,

					// How quickly did they click the mouse, and how long between clicks?
					'bmc': ak_bmc,

					// How many mouseclicks did they make?
					'bmcc': mouseclicks.length,

					// When did they press modifier keys (like Shift or Capslock)?
					'bmk': modifierKeys.join( ';' ),

					// When did they correct themselves? e.g., press Backspace, or use the arrow keys to move the cursor back
					'bck': correctionKeys.join( ';' ),

					// How many times did they move the mouse?
					'bmmc': mousemoves.length,

					// How many times did they move around using a touchscreen?
					'btmc': touchmoveCount,

					// How many times did they scroll?
					'bsc': scrollCount,

					// How quickly did they perform touch events, and how long between them?
					'bte': ak_bte,

					// How many touch events were there?
					'btec' : touchEvents.length,

					// How quickly did they move the mouse, and how long between moves?
					'bmm' : ak_bmm,

					// Click coordinates
					'bcc' : ak_bcc,

					// Milliseconds between last mouse movement and each click
					'bibmac' : ak_bibmac
				};

				var akismet_field_prefix = 'ak_';

				if ( this.getElementsByClassName ) {
					// Check to see if we've used an alternate field name prefix. We store this as an attribute of the container around some of the Akismet fields.
					var possible_akismet_containers = this.getElementsByClassName( 'akismet-fields-container' );

					for ( var containerIndex = 0; containerIndex < possible_akismet_containers.length; containerIndex++ ) {
						var container = possible_akismet_containers.item( containerIndex );

						if ( container.getAttribute( 'data-prefix' ) ) {
							akismet_field_prefix = container.getAttribute( 'data-prefix' );
							break;
						}
					}
				}

				for ( var field_name in input_fields ) {
					var field = document.createElement( 'input' );
					field.setAttribute( 'type', 'hidden' );
					field.setAttribute( 'name', akismet_field_prefix + field_name );
					field.setAttribute( 'value', input_fields[ field_name ] );
					this.appendChild( field );
				}
			}, supportsPassive ? { passive: true } : false  );

			form.addEventListener( 'keydown', function ( e ) {
				// If you hold a key down, some browsers send multiple keydown events in a row.
				// Ignore any keydown events for a key that hasn't come back up yet.
				if ( e.key in keydowns ) {
					return;
				}

				var keydownTime = ( new Date() ).getTime();
				keydowns[ e.key ] = [ keydownTime ];

				if ( ! input_begin ) {
					input_begin = keydownTime;
				}

				// In some situations, we don't want to record an interval since the last keypress -- for example,
				// on the first keypress, or on a keypress after focus has changed to another element. Normally,
				// we want to record the time between the last keyup and this keydown. But if they press a
				// key while already pressing a key, we want to record the time between the two keydowns.

				var lastKeyEvent = Math.max( lastKeydown, lastKeyup );

				if ( lastKeyEvent ) {
					keydowns[ e.key ].push( keydownTime - lastKeyEvent );
				}

				lastKeydown = keydownTime;
			}, supportsPassive ? { passive: true } : false  );

			form.addEventListener( 'keyup', function ( e ) {
				if ( ! ( e.key in keydowns ) ) {
					// This key was pressed before this script was loaded, or a mouseclick happened during the keypress, or...
					return;
				}

				var keyupTime = ( new Date() ).getTime();

				if ( 'TEXTAREA' === e.target.nodeName || 'INPUT' === e.target.nodeName ) {
					if ( -1 !== modifierKeyCodes.indexOf( e.key ) ) {
						modifierKeys.push( keypresses.length - 1 );
					} else if ( -1 !== correctionKeyCodes.indexOf( e.key ) ) {
						correctionKeys.push( keypresses.length - 1 );
					} else {
						// ^ Don't record timings for keys like Shift or backspace, since they
						// typically get held down for longer than regular typing.

						var keydownTime = keydowns[ e.key ][0];

						var keypress = [];

						// Keypress duration.
						keypress.push( keyupTime - keydownTime );

						// Amount of time between this keypress and the previous keypress.
						if ( keydowns[ e.key ].length > 1 ) {
							keypress.push( keydowns[ e.key ][1] );
						}

						keypresses.push( keypress );
					}
				}

				delete keydowns[ e.key ];

				lastKeyup = keyupTime;
			}, supportsPassive ? { passive: true } : false  );

			form.addEventListener( "focusin", function ( e ) {
				lastKeydown = null;
				lastKeyup = null;
				keydowns = {};
			}, supportsPassive ? { passive: true } : false  );

			form.addEventListener( "focusout", function ( e ) {
				lastKeydown = null;
				lastKeyup = null;
				keydowns = {};
			}, supportsPassive ? { passive: true } : false  );
		}

		document.addEventListener( 'mousedown', function ( e ) {
			lastMousedown = ( new Date() ).getTime();

			if ( lastMousemoveTime ) {
				intervalsBetweenMousemovesAndClicks.push( lastMousedown - lastMousemoveTime );
			}

			var mouseclickCoordinate = [];

			var rect = e.target.getBoundingClientRect();
			var relativeX = e.clientX - rect.left;
			var relativeY = e.clientY - rect.top;

			// Pixel offset of the click within the target element.
			mouseclickCoordinate.push( Math.round( relativeX ) );
			mouseclickCoordinate.push( Math.round( relativeY ) );

			// Percentage offset of the click within the target element.
			mouseclickCoordinate.push( rect.width > 0 ? Math.round( relativeX / rect.width * 100 ) : 0 );
			mouseclickCoordinate.push( rect.height > 0 ? Math.round( relativeY / rect.height * 100 ) : 0 );

			mouseclickCoordinates.push( mouseclickCoordinate );
		}, supportsPassive ? { passive: true } : false  );

		document.addEventListener( 'mouseup', function ( e ) {
			if ( ! lastMousedown ) {
				// If the mousedown happened before this script was loaded, but the mouseup happened after...
				return;
			}

			var now = ( new Date() ).getTime();

			var mouseclick = [];
			mouseclick.push( now - lastMousedown );

			if ( lastMouseup ) {
				mouseclick.push( lastMousedown - lastMouseup );
			}

			mouseclicks.push( mouseclick );

			lastMouseup = now;

			// If the mouse has been clicked, don't record this time as an interval between keypresses.
			lastKeydown = null;
			lastKeyup = null;
			keydowns = {};
		}, supportsPassive ? { passive: true } : false  );

		document.addEventListener( 'mousemove', function ( e ) {
			lastMousemoveTime = ( new Date() ).getTime();

			if ( mousemoveTimer ) {
				clearTimeout( mousemoveTimer );
				mousemoveTimer = null;
			}
			else {
				mousemoveStart = lastMousemoveTime;
				lastMousemoveX = e.offsetX;
				lastMousemoveY = e.offsetY;
			}

			mousemoveTimer = setTimeout( function ( theEvent, originalMousemoveStart ) {
				var now = ( new Date() ).getTime() - 500; // To account for the timer delay.

				var mousemove = [];
				mousemove.push( now - originalMousemoveStart );
				mousemove.push(
					Math.round(
						Math.sqrt(
							Math.pow( theEvent.offsetX - lastMousemoveX, 2 ) +
							Math.pow( theEvent.offsetY - lastMousemoveY, 2 )
						)
					)
				);

				if ( mousemove[1] > 0 ) {
					// If there was no measurable distance, then it wasn't really a move.
					mousemoves.push( mousemove );
				}

				mousemoveStart = null;
				mousemoveTimer = null;
			}, 500, e, mousemoveStart );
		}, supportsPassive ? { passive: true } : false  );

		document.addEventListener( 'touchmove', function ( e ) {
			if ( touchmoveCountTimer ) {
				clearTimeout( touchmoveCountTimer );
			}

			touchmoveCountTimer = setTimeout( function () {
				touchmoveCount++;
			}, 500 );
		}, supportsPassive ? { passive: true } : false );

		document.addEventListener( 'touchstart', function ( e ) {
			lastTouchStart = ( new Date() ).getTime();
		}, supportsPassive ? { passive: true } : false );

		document.addEventListener( 'touchend', function ( e ) {
			if ( ! lastTouchStart ) {
				// If the touchstart happened before this script was loaded, but the touchend happened after...
				return;
			}

			var now = ( new Date() ).getTime();

			var touchEvent = [];
			touchEvent.push( now - lastTouchStart );

			if ( lastTouchEnd ) {
				touchEvent.push( lastTouchStart - lastTouchEnd );
			}

			touchEvents.push( touchEvent );

			lastTouchEnd = now;

			// Don't record this time as an interval between keypresses.
			lastKeydown = null;
			lastKeyup = null;
			keydowns = {};
		}, supportsPassive ? { passive: true } : false );

		document.addEventListener( 'scroll', function ( e ) {
			if ( scrollCountTimer ) {
				clearTimeout( scrollCountTimer );
			}

			scrollCountTimer = setTimeout( function () {
				scrollCount++;
			}, 500 );
		}, supportsPassive ? { passive: true } : false );
	}

	/**
	 * For the timing/coordinate data that is collected, don't send more than `limit` data points in the request.
	 * Choose a random slice and send those, with each batch separated by semicolons and the items in each batch
	 * separated by commas.
	 */
	function prepare_array_for_request( a, limit ) {
		if ( ! limit ) {
			limit = 100;
		}

		var rv = '';

		if ( a.length > 0 ) {
			var random_starting_point = Math.max( 0, Math.floor( Math.random() * a.length - limit ) );

			for ( var i = 0; i < limit && i < a.length; i++ ) {
				var entry = a[ random_starting_point + i ];
				rv += entry.join( ',' ) + ';';
			}
		}

		return rv;
	}

	if ( document.readyState !== 'loading' ) {
		init();
	} else {
		document.addEventListener( 'DOMContentLoaded', init );
	}
})();;
( function () {
	'use strict';

	if ( typeof window.wpcom === 'undefined' ) {
		window.wpcom = {};
	}

	if ( window.wpcom.carousel ) {
		return;
	}

	var prebuilt_widths = jetpackCarouselStrings.widths;
	var pageviews_stats_args = jetpackCarouselStrings.stats_query_args;

	var findFirstLargeEnoughWidth = function ( original_w, original_h, dest_w, dest_h ) {
		var inverse_ratio = original_h / original_w;

		for ( var i = 0; i < prebuilt_widths.length; ++i ) {
			if ( prebuilt_widths[ i ] >= dest_w || prebuilt_widths[ i ] * inverse_ratio >= dest_h ) {
				return prebuilt_widths[ i ];
			}
		}

		return original_w;
	};

	var removeResizeFromImageURL = function ( url ) {
		return removeArgFromURL( url, 'resize' );
	};

	var removeArgFromURL = function ( url, arg ) {
		var re = new RegExp( '[\\?&]' + arg + '(=[^?&]+)?' );
		if ( url.match( re ) ) {
			return url.replace( re, '' );
		}
		return url;
	};

	var addWidthToImageURL = function ( url, width ) {
		width = parseInt( width, 10 );
		// Give devices with a higher devicePixelRatio higher-res images (Retina display = 2, Android phones = 1.5, etc)
		if ( 'undefined' !== typeof window.devicePixelRatio && window.devicePixelRatio > 1 ) {
			width = Math.round( width * window.devicePixelRatio );
		}
		url = addArgToURL( url, 'w', width );
		url = addArgToURL( url, 'h', '' );
		return url;
	};

	var addArgToURL = function ( url, arg, value ) {
		var re = new RegExp( arg + '=[^?&]+' );
		if ( url.match( re ) ) {
			return url.replace( re, arg + '=' + value );
		} else {
			var divider = url.indexOf( '?' ) !== -1 ? '&' : '?';
			return url + divider + arg + '=' + value;
		}
	};

	var stat = function ( names ) {
		if ( typeof names !== 'string' ) {
			names = names.join( ',' );
		}

		new Image().src = window.location.protocol +
			'//pixel.wp.com/g.gif?v=wpcom-no-pv' +
			'&x_carousel=' + names +
			'&baba=' + Math.random();
	};

	var lastTrackedPostId = null;

	var pageview = function ( post_id ) {
		// Prevent duplicate tracking of the same post during slide transitions
		if ( post_id === lastTrackedPostId ) {
			return;
		}

		lastTrackedPostId = post_id;

		new Image().src = window.location.protocol +
			'//pixel.wp.com/g.gif?host=' + encodeURIComponent( window.location.host ) +
			'&ref=' + encodeURIComponent( document.referrer ) +
			'&rand=' + Math.random() +
			'&' + pageviews_stats_args +
			'&post=' + encodeURIComponent( post_id );
	};

	var generateImgSrc = function ( srcItem, max ) {
		var origSize = srcItem.getAttribute( 'data-orig-size' ) || '';

		var src = srcItem.getAttribute( 'src' ) || srcItem.getAttribute( 'original' ) || srcItem.getAttribute( 'data-original' ) || srcItem.getAttribute( 'data-lazy-src' );
		if ( src.indexOf( 'imgpress' ) !== -1 ) {
			src = srcItem.getAttribute( 'data-orig-file' );
		}
		// Square/Circle galleries use a resize param that needs to be removed.
		src = removeResizeFromImageURL( src );
		src = addWidthToImageURL(
			src,
			findFirstLargeEnoughWidth( origSize.width, origSize.height, max.width, max.height )
		);

		return src;
	};

	window.wpcom.carousel = {
		findFirstLargeEnoughWidth: findFirstLargeEnoughWidth,
		removeResizeFromImageURL: removeResizeFromImageURL,
		addWidthToImageURL: addWidthToImageURL,
		stat: stat,
		pageview: pageview,
		generateImgSrc: generateImgSrc
	};

} )();
;
