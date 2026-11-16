/**
 * Comment Likes - JavaScript
 *
 * This handles liking and unliking comments, as well as viewing who has
 * liked a particular comment.
 *
 * @dependency  Swipe (dynamically loaded when needed)
 *
 * @package     Comment_Likes
 * @subpackage  JavaScript
 */
(function () {
	function init() {
		let extWin;
		let extWinCheck;
		let commentLikeEvent;

		// Only run once.
		if (window.comment_likes_loaded) {
			return;
		}
		window.comment_likes_loaded = true;

		// Client-side cache of who liked a particular comment to avoid
		// having to hit the server multiple times for the same data.
		const commentLikeCache = {};

		let swipeLibPromise;

		// Load the Swipe library, if it's not already loaded.
		function swipeLibLoader() {
			if (!swipeLibPromise) {
				swipeLibPromise = new Promise((resolve, reject) => {
					if (window.Swipe) {
						resolve(window.Swipe);
					} else {
						const swipeScript = document.createElement('script');
						swipeScript.src = comment_like_text.swipeUrl;
						swipeScript.async = true;
						document.body.appendChild(swipeScript);
						swipeScript.addEventListener('load', () => resolve(window.Swipe));
						swipeScript.addEventListener('error', error => reject(error));
					}
				});
			}
			return swipeLibPromise;
		}

		/**
		 * Parse the comment ID from a comment like link.
		 */
		function getCommentId(link) {
			const commentId =
				link && link.getAttribute('href') && link.getAttribute('href').split('like_comment=');
			return commentId[1].split('&_wpnonce=')[0];
		}

		/**
		 * Handle an ajax action on the comment like link.
		 */
		function handleLinkAction(link, action, commentId, callback) {
			const nonce =
				link && link.getAttribute('href') && link.getAttribute('href').split('_wpnonce=')[1];

			fetch('/wp-admin/admin-ajax.php', {
				method: 'POST',
				body: new URLSearchParams({
					action: action,
					_wpnonce: nonce,
					like_comment: commentId,
					blog_id: Number(link.dataset.blog),
				}),
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
					'X-Requested-With': 'XMLHttpRequest',
					Accept: 'application/json',
					'cache-control': 'no-cache',
					pragma: 'no-cache',
				},
			})
				.then(response => response.json())
				.then(callback);
		}

		function startPolling() {
			// Append cookie polling login iframe to this window to wait for user to finish logging in (or cancel)
			const loginIframe = document.createElement('iframe');
			loginIframe.id = 'wp-login-polling-iframe';
			loginIframe.src = 'https://wordpress.com/public.api/connect/?iframe=true';
			document.body.appendChild(loginIframe);
			loginIframe.style.display = 'none';
		}

		function stopPolling() {
			const iframe = document.querySelector('#wp-login-polling-iframe');
			if (iframe) {
				iframe.remove();
			}
		}

		function hide(el) {
			if (el && el.style) {
				el.style.display = 'none';
			}
		}

		function show(el) {
			if (el && el.style) {
				el.style.removeProperty('display');
			}
		}

		// Overlay used for displaying comment like info.
		class Overlay {
			constructor() {
				// Overlay element.
				this.el = document.createElement('div');
				this.el.classList.add('comment-likes-overlay');
				document.body.appendChild(this.el);
				hide(this.el);

				this.el.addEventListener('mouseenter', () => {
					// Don't hide the overlay if the user is mousing over it.
					overlay.cancelHide();
				});

				this.el.addEventListener('mouseleave', () => overlay.requestHide());

				// Inner contents of overlay.
				this.innerEl = null;

				// Instance of the Swipe library.
				this.swipe = null;

				// Timeout used for hiding the overlay.
				this.hideTimeout = null;
			}

			// Initialise the overlay for use, removing any old content.
			clear() {
				// Unload any previous instance of Swipe (to avoid leaking a global
				// event handler). This is done before clearing the contents of the
				// overlay because Swipe expects the slides to still be present.
				if (this.swipe) {
					this.swipe.kill();
					this.swipe = null;
				}
				this.el.innerHTML = '';
				this.innerEl = document.createElement('div');
				this.innerEl.classList.add('inner');
				this.el.appendChild(this.innerEl);
			}

			/**
			 * Construct a list (<ul>) of user (gravatar, name) details.
			 *
			 * @param  data     liker data returned from the server
			 * @param  klass    CSS class to apply to the <ul> element
			 * @param  start    index of user to start at
			 * @param  length   number of users to include in the list
			 *
			 * @return          A container element with the list
			 */
			getUserBits(data, klass, start, length) {
				start = start || 0;
				let last = start + (length || data.length);
				last = last > data.length ? data.length : last;
				const container = document.createElement('div');
				container.classList.add('liker-list');
				let html = `<ul class="${klass || ''}">`;
				for (let i = start; i < last; ++i) {
					const user = data[i];
					html += `
						<li>
							<a rel="nofollow" title="${user.display_name_esc}" href="${user.profile_url_esc}">
								<img src="${user.avatar_url_esc}" alt="${user.display_name_esc}" />
								<span class="user-name">${user.display_name_esc}</span>
							</a>
						</li>
					`;
				}
				html += '</ul>';
				container.innerHTML = html;
				return container;
			}

			/**
			 * Render the display of who has liked this comment. The type of
			 * display depends on how many people have liked the comment.
			 * If more than 10 people have liked the comment, this function
			 * renders navigation controls and sets up the Swipe library for
			 * changing between pages.
			 *
			 * @param link  the element over which the user is hovering
			 * @param data  the results retrieved from the server
			 */
			showLikes(link, data) {
				this.clear();

				link.dataset.likeCount = data.length;
				if (data.length === 0) {
					// No likers after all.
					hide(this.el);
					return;
				}

				this.innerEl.style.padding = '12px';

				if (data.length < 6) {
					// Only one column needed.
					this.innerEl.style.maxWidth = '200px';
					this.innerEl.innerHTML = '';
					this.innerEl.appendChild(this.getUserBits(data, 'single'));
					this.setPosition(link);
				} else if (data.length < 11) {
					// Two columns, but only one page.
					this.innerEl.innerHTML = '';
					this.innerEl.appendChild(this.getUserBits(data, 'double'));
					this.setPosition(link);
				} else {
					// Multiple pages.
					this.renderLikesWithPagination(data, link);
				}
			}

			/**
			 * Render multiple pages of likes with pagination controls.
			 * This function is intended to be called by `showLikes` above.
			 *
			 * @param data  the results retrieved from the server
			 */
			renderLikesWithPagination(data, link) {
				swipeLibLoader().then(() => {
					const page_count = Math.ceil(data.length / 10);
					// Swipe requires two nested containers.
					const swipe = document.createElement('div');
					swipe.classList.add('swipe');
					this.innerEl.appendChild(swipe);

					const wrap = document.createElement('div');
					wrap.classList.add('swipe-wrap');
					swipe.appendChild(wrap);

					for (let i = 0; i < page_count; ++i) {
						wrap.appendChild(this.getUserBits(data, 'double', i * 10, 10));
					}

					/**
					 * Navigation controls.
					 * This is based on the Newdash controls found in
					 *    reader/recommendations-templates.php
					 */
					const nav = document.createElement('nav');
					nav.classList.add('slider-nav');

					let navContents = `
						<a href="#" class="prev">
							<span class="noticon noticon-previous" title="Previous" alt="<"></span>
						</a>
						<span class="position">
					`;
					for (let i = 0; i < page_count; ++i) {
						navContents += `<em data-page="${i}" class="${i === 0 ? 'on' : ''}">&bull;</em>`;
					}
					navContents += `
						</span>
						<a href="#" class="next">
							<span class="noticon noticon-next" title="Next" alt=">"></span>
						</a>
					`;
					this.innerEl.appendChild(nav);
					nav.innerHTML = navContents;

					/** Set up Swipe. **/
					// Swipe cannot be set up successfully unless its container
					// is visible, so we show it now.
					show(this.el);
					this.setPosition(link);

					this.swipe = new Swipe(swipe, {
						callback: function (pos) {
							// Update the pagination indicators.
							//
							// If there are exactly two pages, Swipe has a weird
							// special case where it duplicates both pages and
							// can return index 2 and 3 even though those aren't
							// real pages (see swipe.js, line 47). To deal with
							// this, we use the expression `pos % page_count`.
							pos = pos % page_count;
							nav.querySelectorAll('em').forEach(em => {
								const page = Number(em.dataset.page);
								em.setAttribute('class', pos === page ? 'on' : '');
							});
						},
					});

					nav.querySelectorAll('em').forEach(em => {
						em.addEventListener('click', e => {
							// Go to the page corresponding to the indicator clicked.
							this.swipe.slide(Number(em.dataset.page));
							e.preventDefault();
						});
					});
					// Previous and next buttons.
					nav.querySelector('.prev').addEventListener('click', e => {
						this.swipe.prev();
						e.preventDefault();
					});
					nav.querySelector('.next').addEventListener('click', e => {
						this.swipe.next();
						e.preventDefault();
					});
				});
			}

			/**
			 * Open the overlay and show a loading message.
			 */
			showLoadingMessage(link) {
				this.clear();
				this.innerEl.textContent = comment_like_text.loading;
				this.setPosition(link);
			}

			/**
			 * Position the overlay near the current comment.
			 *
			 * @param link  element near which to position the overlay
			 */
			setPosition(link) {
				// Prepare a down arrow icon for the bottom of the overlay.
				const icon = document.createElement('span');
				this.el.appendChild(icon);
				icon.classList.add('icon', 'noticon', 'noticon-downarrow');
				icon.style.textShadow = '0px 1px 1px rgb(223, 223, 223)';

				const rect = link.getBoundingClientRect();
				const win = document.defaultView;
				const offset = {
					top: rect.top + win.scrollY,
					left: rect.left + win.scrollX,
				};

				// Take measurements with the element fully visible.
				show(this.el);
				let left = offset.left - (this.el.offsetWidth - link.offsetWidth) / 2;
				left = left < 5 ? 5 : left;
				let top = offset.top - this.el.offsetHeight + 5;
				hide(this.el);

				const adminBar = document.querySelector('#wpadminbar');

				// Check if the overlay would appear off the screen.
				if (top < win.scrollY + ((adminBar && adminBar.offsetHeight) || 0)) {
					// We'll display the overlay beneath the link instead.
					top = offset.top + link.offsetHeight;
					// Instead of using the down arrow icon, use an up arrow.
					icon.remove();
					this.el.prepend(icon);
					icon.classList.remove('noticon-downarrow');
					icon.classList.add('noticon-uparrow');
					icon.style.textShadow = '0px -1px 1px rgb(223, 223, 223)';
					icon.style.verticalAlign = 'bottom';
				}

				this.el.style.left = `${left}px`;
				this.el.style.top = `${top}px`;
				show(this.el);

				// The height of the arrow icon differs slightly between browsers,
				// so we compute the margin here to make sure it isn't disjointed
				// from the overlay.
				icon.style.marginTop = `${icon.scrollHeight - 26}px`;
				icon.style.marginBottom = `${20 - icon.scrollHeight}px`;

				// Position the arrow to be horizontally centred on the link.
				icon.style.paddingLeft = `${
					offset.left - left + (link.offsetWidth - icon.scrollWidth) / 2
				}px`;
			}

			/**
			 * Return whether the overlay is visible.
			 */
			isVisible() {
				return this.el.style.getPropertyValue('display') !== 'none';
			}

			/**
			 * Request that the overlay be hidden after a short delay.
			 */
			requestHide() {
				if (this.hideTimeout !== null) {
					return;
				}
				this.hideTimeout = setTimeout(() => {
					hide(this.el);
					this.clear();
				}, 300);
			}

			/**
			 * Cancel a request to hide the overlay.
			 */
			cancelHide() {
				if (this.hideTimeout !== null) {
					clearTimeout(this.hideTimeout);
					this.hideTimeout = null;
				}
			}
		}

		// Overlay used for displaying comment like info.
		const overlay = new Overlay();

		// The most recent comment for which the user has requested to see
		// who liked it.
		var relevantComment;

		// Precache after this timeout.
		var precacheTimeout = null;

		/**
		 * Fetch the like data for a particular comment.
		 */
		function fetchLikeData(link, commentId) {
			commentLikeCache[commentId] = null;

			const container = link && link.parentElement && link.parentElement.parentElement;
			const star = container.querySelector('a.comment-like-link');
			star &&
				handleLinkAction(star, 'view_comment_likes', commentId, data => {
					// Populate the cache.
					commentLikeCache[commentId] = data;

					// Only show the overlay if the user is interested.
					if (overlay.isVisible() && relevantComment === commentId) {
						overlay.showLikes(link, data);
					}
				});
		}

		function readCookie(c) {
			const nameEQ = c + '=';
			const cookieStrings = document.cookie.split(';');

			for (let i = 0; i < cookieStrings.length; i++) {
				let cookieString = cookieStrings[i];
				while (cookieString.charAt(0) === ' ') {
					cookieString = cookieString.substring(1, cookieString.length);
				}
				if (cookieString.indexOf(nameEQ) === 0) {
					const chunk = cookieString.substring(nameEQ.length, cookieString.length);
					const pairs = chunk.split('&');
					const cookieData = {};
					for (let num = pairs.length - 1; num >= 0; num--) {
						const pair = pairs[num].split('=');
						cookieData[pair[0]] = decodeURIComponent(pair[1]);
					}
					return cookieData;
				}
			}
			return null;
		}

		function getServiceData() {
			const data = readCookie('wpc_wpc');
			if (data === null || typeof data.access_token === 'undefined' || !data.access_token) {
				return false;
			}
			return data;
		}

		function readMessage(msg) {
			const event = msg.data;

			if (typeof event.event === 'undefined') {
				return;
			}

			if (event.event === 'login' && event.success) {
				extWinCheck = setInterval(function () {
					if (!extWin || extWin.closed) {
						clearInterval(extWinCheck);
						if (getServiceData()) {
							// Load page in an iframe to get the current comment nonce
							const nonceIframe = document.createElement('iframe');
							nonceIframe.id = 'wp-login-comment-nonce-iframe';
							nonceIframe.style.display = 'none';
							nonceIframe.src = commentLikeEvent + '';
							document.body.appendChild(nonceIframe);

							const commentLikeId = (commentLikeEvent + '')
								.split('like_comment=')[1]
								.split('&_wpnonce=')[0];
							let c;

							// Set a 5 second timeout to redirect to the comment page without doing the Like as a fallback
							const commentLikeTimeout = setTimeout(() => {
								window.location = commentLikeEvent;
							}, 5000);

							// Check for a new nonced redirect and use that if available before timing out
							const commentLikeCheck = setInterval(() => {
								const iframe = document.querySelector('#wp-login-comment-nonce-iframe');
								if (iframe) {
									c = iframe.querySelector(`#comment-like-${commentLikeId} .comment-like-link`);
								}
								if (c && typeof c.href !== 'undefined') {
									clearTimeout(commentLikeTimeout);
									clearInterval(commentLikeCheck);
									window.location = c.href;
								}
							}, 100);
						}
					}
				}, 100);

				if (extWin) {
					if (!extWin.closed) {
						extWin.close();
					}
					extWin = false;
				}

				stopPolling();
			}
		}

		if (typeof window.postMessage !== 'undefined') {
			window.addEventListener('message', e => {
				let message = e && e.data;
				if (typeof message === 'string') {
					try {
						message = JSON.parse(message);
					} catch (err) {
						return;
					}
				}

				const type = message && message.type;
				if (type === 'loginMessage') {
					readMessage(message);
				}
			});
		}

		document.body.addEventListener('click', e => {
			let target = e.target;

			// Don't do anything when clicking on the "X people" link.
			if (target.matches('p.comment-likes a.view-likers')) {
				e.preventDefault();
				return;
			}

			// Retrieve the surrounding paragraph to the star, if it hasn't been liked.
			const notLikedPar = target.closest('p.comment-not-liked');

			// Return if not clicking on star or surrounding paragraph.
			if (!target.matches('a.comment-like-link') && !notLikedPar) {
				return;
			}

			// When a comment hasn't been liked, make the text clickable, too.
			if (notLikedPar) {
				target = notLikedPar.querySelector('a.comment-like-link');
				if (!target) {
					return;
				}
			}

			if (target.classList.contains('needs-login')) {
				e.preventDefault();
				commentLikeEvent = target;
				if (extWin) {
					if (!extWin.closed) {
						extWin.close();
					}
					extWin = false;
				}

				stopPolling();

				const url = 'https://wordpress.com/public.api/connect/?action=request&service=wordpress';
				extWin = window.open(
					url,
					'likeconn',
					'status=0,toolbar=0,location=1,menubar=0,directories=0,resizable=1,scrollbars=1,height=560,width=500'
				);

				startPolling();

				return false;
			}

			// Record that the user likes or does not like this comment.
			const commentId = getCommentId(target);
			target.classList.add('loading');

			let commentEl = document.querySelector(`p#comment-like-${commentId}`);
			// Determine whether to like or unlike based on whether the comment is
			// currently liked.
			const action =
				commentEl && commentEl.dataset.liked === 'comment-liked'
					? 'unlike_comment'
					: 'like_comment';
			handleLinkAction(target, action, commentId, data => {
				// Invalidate the like cache for this comment.
				delete commentLikeCache[commentId];

				const countEl = document.querySelector(`#comment-like-count-${data.context}`);
				if (countEl) {
					countEl.innerHTML = data.display;
				}

				commentEl = document.querySelector(`p#comment-like-${data.context}`);
				if (action === 'like_comment') {
					commentEl.classList.remove('comment-not-liked');
					commentEl.classList.add('comment-liked');
					commentEl.dataset.liked = 'comment-liked';
				} else {
					commentEl.classList.remove('comment-liked');
					commentEl.classList.add('comment-not-liked');
					commentEl.dataset.liked = 'comment-not-liked';
				}

				// Prefetch new data for this comment (if there are likers left).
				const parent = target.closest('.comment-likes');
				const link = parent && parent.querySelector('a.view-likers');
				if (link) {
					fetchLikeData(link, commentId);
				}

				target.classList.remove('loading');
			});
			e.preventDefault();
			e.stopPropagation();
		});

		document.body.addEventListener(
			'mouseenter',
			function (e) {
				if (!e.target.matches('p.comment-likes a.view-likers')) {
					return;
				}
				// Show the user a list of who has liked this comment.

				const link = e.target;
				if (Number(link.dataset.likeCount || 0) === 0) {
					// No one has liked this comment.
					return;
				}

				// Don't hide the overlay.
				overlay.cancelHide();

				// Get the comment ID.
				const container = link.parentElement && link.parentElement.parentElement;
				const star = container && container.querySelector('a.comment-like-link');
				const commentId = star && getCommentId(star);
				relevantComment = commentId;

				// Check if the list of likes for this comment is already in
				// the cache.
				if (commentId in commentLikeCache) {
					const entry = commentLikeCache[commentId];
					// Only display the likes if the ajax request is
					// actually done.
					if (entry !== null) {
						overlay.showLikes(link, entry);
					} else {
						// Make sure the overlay is visible (in case
						// the user moved the mouse away while loading
						// but then came back before it finished
						// loading).
						overlay.showLoadingMessage(link);
					}
					return;
				}

				// Position the "Loading..." overlay.
				overlay.showLoadingMessage(link);

				// Fetch the data.
				fetchLikeData(link, commentId);
			},
			true
		);

		document.body.addEventListener(
			'mouseleave',
			e => {
				if (!e.target.matches('p.comment-likes a.view-likers')) {
					return;
				}
				// User has moved cursor away - hide the overlay.
				overlay.requestHide();
			},
			true
		);

		document.body.addEventListener(
			'mouseenter',
			e => {
				if (!e.target.matches('.comment') || !e.target.querySelector('a.comment-like-link')) {
					return;
				}
				// User is moving over a comment - precache the comment like data.
				if (precacheTimeout !== null) {
					clearTimeout(precacheTimeout);
					precacheTimeout = null;
				}

				const star = e.target.querySelector('a.comment-like-link');
				const parent = star.closest('.comment-likes');
				const link = parent && parent.querySelector('a.view-likers');
				if (!link || Number(link.dataset.likeCount || 0) === 0) {
					// No likes.
					return;
				}
				const commentId = getCommentId(star);
				if (commentId in commentLikeCache) {
					// Already in cache.
					return;
				}

				precacheTimeout = setTimeout(() => {
					precacheTimeout = null;
					if (commentId in commentLikeCache) {
						// Was cached in the interim.
						return;
					}
					fetchLikeData(link, commentId);
				}, 1000);
			},
			true
		);
	}

	if (document.readyState !== 'loading') {
		init();
	} else {
		document.addEventListener('DOMContentLoaded', init);
	}
})();
;
/**
 * File skip-link-focus-fix.js.
 *
 * Helps with accessibility for keyboard only users.
 *
 * Learn more: https://git.io/vWdr2
 */
(function() {
	var isIe = /(trident|msie)/i.test( navigator.userAgent );

	if ( isIe && document.getElementById && window.addEventListener ) {
		window.addEventListener( 'hashchange', function() {
			var id = location.hash.substring( 1 ),
				element;

			if ( ! ( /^[A-z0-9_-]+$/.test( id ) ) ) {
				return;
			}

			element = document.getElementById( id );

			if ( element ) {
				if ( ! ( /^(?:a|select|input|button|textarea)$/i.test( element.tagName ) ) ) {
					element.tabIndex = -1;
				}

				element.focus();
			}
		}, false );
	}
})();
;
/* global twentyseventeenScreenReaderText */
/**
 * Theme functions file.
 *
 * Contains handlers for navigation and widget area.
 */

(function( $ ) {
	var masthead, menuToggle, siteNavContain, siteNavigation;

	function initMainNavigation( container ) {

		// Add dropdown toggle that displays child menu items.
		var dropdownToggle = $( '<button />', { 'class': 'dropdown-toggle', 'aria-expanded': false })
			.append( twentyseventeenScreenReaderText.icon )
			.append( $( '<span />', { 'class': 'screen-reader-text', text: twentyseventeenScreenReaderText.expand }) );

		container.find( '.menu-item-has-children > a, .page_item_has_children > a' ).after( dropdownToggle );

		// Set the active submenu dropdown toggle button initial state.
		container.find( '.current-menu-ancestor > button' )
			.addClass( 'toggled-on' )
			.attr( 'aria-expanded', 'true' )
			.find( '.screen-reader-text' )
			.text( twentyseventeenScreenReaderText.collapse );
		// Set the active submenu initial state.
		container.find( '.current-menu-ancestor > .sub-menu' ).addClass( 'toggled-on' );

		container.find( '.dropdown-toggle' ).on( 'click', function( e ) {
			var _this = $( this ),
				screenReaderSpan = _this.find( '.screen-reader-text' );

			e.preventDefault();
			_this.toggleClass( 'toggled-on' );
			_this.next( '.children, .sub-menu' ).toggleClass( 'toggled-on' );

			_this.attr( 'aria-expanded', _this.attr( 'aria-expanded' ) === 'false' ? 'true' : 'false' );

			screenReaderSpan.text( screenReaderSpan.text() === twentyseventeenScreenReaderText.expand ? twentyseventeenScreenReaderText.collapse : twentyseventeenScreenReaderText.expand );
		});
	}

	initMainNavigation( $( '.main-navigation' ) );

	masthead       = $( '#masthead' );
	menuToggle     = masthead.find( '.menu-toggle' );
	siteNavContain = masthead.find( '.main-navigation' );
	siteNavigation = masthead.find( '.main-navigation > div > ul' );

	// Enable menuToggle.
	(function() {

		// Return early if menuToggle is missing.
		if ( ! menuToggle.length ) {
			return;
		}

		// Add an initial value for the attribute.
		menuToggle.attr( 'aria-expanded', 'false' );

		menuToggle.on( 'click.twentyseventeen', function() {
			siteNavContain.toggleClass( 'toggled-on' );

			$( this ).attr( 'aria-expanded', siteNavContain.hasClass( 'toggled-on' ) );
		});
	})();

	// Fix sub-menus for touch devices and better focus for hidden submenu items for accessibility.
	(function() {
		if ( ! siteNavigation.length || ! siteNavigation.children().length ) {
			return;
		}

		// Toggle `focus` class to allow submenu access on tablets.
		function toggleFocusClassTouchScreen() {
			if ( 'none' === $( '.menu-toggle' ).css( 'display' ) ) {

				$( document.body ).on( 'touchstart.twentyseventeen', function( e ) {
					if ( ! $( e.target ).closest( '.main-navigation li' ).length ) {
						$( '.main-navigation li' ).removeClass( 'focus' );
					}
				});

				siteNavigation.find( '.menu-item-has-children > a, .page_item_has_children > a' )
					.on( 'touchstart.twentyseventeen', function( e ) {
						var el = $( this ).parent( 'li' );

						if ( ! el.hasClass( 'focus' ) ) {
							e.preventDefault();
							el.toggleClass( 'focus' );
							el.siblings( '.focus' ).removeClass( 'focus' );
						}
					});

			} else {
				siteNavigation.find( '.menu-item-has-children > a, .page_item_has_children > a' ).unbind( 'touchstart.twentyseventeen' );
			}
		}

		if ( 'ontouchstart' in window ) {
			$( window ).on( 'resize.twentyseventeen', toggleFocusClassTouchScreen );
			toggleFocusClassTouchScreen();
		}

		siteNavigation.find( 'a' ).on( 'focus.twentyseventeen blur.twentyseventeen', function() {
			$( this ).parents( '.menu-item, .page_item' ).toggleClass( 'focus' );
		});
	})();
})( jQuery );
;
/* global twentyseventeenScreenReaderText */
(function( $ ) {

	// Variables and DOM Caching.
	var $body = $( 'body' ),
		$customHeader = $body.find( '.custom-header' ),
		$branding = $customHeader.find( '.site-branding' ),
		$navigation = $body.find( '.navigation-top' ),
		$navWrap = $navigation.find( '.wrap' ),
		$navMenuItem = $navigation.find( '.menu-item' ),
		$menuToggle = $navigation.find( '.menu-toggle' ),
		$menuScrollDown = $body.find( '.menu-scroll-down' ),
		$sidebar = $body.find( '#secondary' ),
		$entryContent = $body.find( '.entry-content' ),
		$formatQuote = $body.find( '.format-quote blockquote' ),
		isFrontPage = $body.hasClass( 'twentyseventeen-front-page' ) || $body.hasClass( 'home blog' ),
		navigationFixedClass = 'site-navigation-fixed',
		navigationHeight,
		navigationOuterHeight,
		navPadding,
		navMenuItemHeight,
		idealNavHeight,
		navIsNotTooTall,
		headerOffset,
		menuTop = 0,
		resizeTimer;

	// Ensure the sticky navigation doesn't cover current focused links.
	$( 'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), iframe, object, embed, [tabindex], [contenteditable]', '.site-content-contain' ).filter( ':visible' ).on( 'focus', function() {
		if ( $navigation.hasClass( 'site-navigation-fixed' ) ) {
			var windowScrollTop = $( window ).scrollTop(),
				fixedNavHeight = $navigation.height(),
				itemScrollTop = $( this ).offset().top,
				offsetDiff = itemScrollTop - windowScrollTop;

			// Account for Admin bar.
			if ( $( '#wpadminbar' ).length ) {
				offsetDiff -= $( '#wpadminbar' ).height();
			}

			if ( offsetDiff < fixedNavHeight ) {
				$( window ).scrollTo( itemScrollTop - ( fixedNavHeight + 50 ), 0 );
			}
		}
	});

	// Set properties of navigation.
	function setNavProps() {
		navigationHeight      = $navigation.height();
		navigationOuterHeight = $navigation.outerHeight();
		navPadding            = parseFloat( $navWrap.css( 'padding-top' ) ) * 2;
		navMenuItemHeight     = $navMenuItem.outerHeight() * 2;
		idealNavHeight        = navPadding + navMenuItemHeight;
		navIsNotTooTall       = navigationHeight <= idealNavHeight;
	}

	// Make navigation 'stick'.
	function adjustScrollClass() {

		// Make sure we're not on a mobile screen.
		if ( 'none' === $menuToggle.css( 'display' ) ) {

			// Make sure the nav isn't taller than two rows.
			if ( navIsNotTooTall ) {

				// When there's a custom header image or video, the header offset includes the height of the navigation.
				if ( isFrontPage && ( $body.hasClass( 'has-header-image' ) || $body.hasClass( 'has-header-video' ) ) ) {
					headerOffset = $customHeader.innerHeight() - navigationOuterHeight;
				} else {
					headerOffset = $customHeader.innerHeight();
				}

				// If the scroll is more than the custom header, set the fixed class.
				if ( $( window ).scrollTop() >= headerOffset ) {
					$navigation.addClass( navigationFixedClass );
				} else {
					$navigation.removeClass( navigationFixedClass );
				}

			} else {

				// Remove 'fixed' class if nav is taller than two rows.
				$navigation.removeClass( navigationFixedClass );
			}
		}
	}

	// Set margins of branding in header.
	function adjustHeaderHeight() {
		if ( 'none' === $menuToggle.css( 'display' ) ) {

			// The margin should be applied to different elements on front-page or home vs interior pages.
			if ( isFrontPage ) {
				$branding.css( 'margin-bottom', navigationOuterHeight );
			} else {
				$customHeader.css( 'margin-bottom', navigationOuterHeight );
			}

		} else {
			$customHeader.css( 'margin-bottom', '0' );
			$branding.css( 'margin-bottom', '0' );
		}
	}

	// Set icon for quotes.
	function setQuotesIcon() {
		$( twentyseventeenScreenReaderText.quote ).prependTo( $formatQuote );
	}

	// Add 'below-entry-meta' class to elements.
	function belowEntryMetaClass( param ) {
		var sidebarPos, sidebarPosBottom;

		if ( ! $body.hasClass( 'has-sidebar' ) ||
			typeof $sidebar === 'undefined' ||
			$sidebar.length < 1 || (
			$body.hasClass( 'search' ) ||
			$body.hasClass( 'single-attachment' ) ||
			$body.hasClass( 'error404' ) ||
			$body.hasClass( 'twentyseventeen-front-page' )
		) ) {
			return;
		}

		sidebarPos       = $sidebar.offset();
		sidebarPosBottom = sidebarPos.top + ( $sidebar.height() + 28 );

		$entryContent.find( param ).each( function() {
			var $element = $( this ),
				elementPos = $element.offset(),
				elementPosTop = elementPos.top;

			// Add 'below-entry-meta' to elements below the entry meta.
			if ( elementPosTop > sidebarPosBottom ) {
				$element.addClass( 'below-entry-meta' );
			} else {
				$element.removeClass( 'below-entry-meta' );
			}
		});
	}

	/*
	 * Test if inline SVGs are supported.
	 * @link https://github.com/Modernizr/Modernizr/
	 */
	function supportsInlineSVG() {
		var div = document.createElement( 'div' );
		div.innerHTML = '<svg/>';
		return 'http://www.w3.org/2000/svg' === ( 'undefined' !== typeof SVGRect && div.firstChild && div.firstChild.namespaceURI );
	}

	/**
	 * Test if an iOS device.
	*/
	function checkiOS() {
		return /iPad|iPhone|iPod/.test(navigator.userAgent) && ! window.MSStream;
	}

	/*
	 * Test if background-attachment: fixed is supported.
	 * @link http://stackoverflow.com/questions/14115080/detect-support-for-background-attachment-fixed
	 */
	function supportsFixedBackground() {
		var el = document.createElement('div'),
			isSupported;

		try {
			if ( ! ( 'backgroundAttachment' in el.style ) || checkiOS() ) {
				return false;
			}
			el.style.backgroundAttachment = 'fixed';
			isSupported = ( 'fixed' === el.style.backgroundAttachment );
			return isSupported;
		}
		catch (e) {
			return false;
		}
	}

	// Fire on document ready.
	$( function() {

		// If navigation menu is present on page, setNavProps and adjustScrollClass.
		if ( $navigation.length ) {
			setNavProps();
			adjustScrollClass();
		}

		// If 'Scroll Down' arrow in present on page, calculate scroll offset and bind an event handler to the click event.
		if ( $menuScrollDown.length ) {

			if ( $( 'body' ).hasClass( 'admin-bar' ) ) {
				menuTop -= 32;
			}
			if ( $( 'body' ).hasClass( 'blog' ) ) {
				menuTop -= 30; // The div for latest posts has no space above content, add some to account for this.
			}
			if ( ! $navigation.length ) {
				navigationOuterHeight = 0;
			}

			$menuScrollDown.on( 'click', function( e ) {
				e.preventDefault();
				$( window ).scrollTo( '#primary', {
					duration: 600,
					offset: { top: menuTop - navigationOuterHeight }
				});
			});
		}

		adjustHeaderHeight();
		setQuotesIcon();
		belowEntryMetaClass( 'blockquote.alignleft, blockquote.alignright' );
		if ( true === supportsInlineSVG() ) {
			document.documentElement.className = document.documentElement.className.replace( /(\s*)no-svg(\s*)/, '$1svg$2' );
		}

		if ( true === supportsFixedBackground() ) {
			document.documentElement.className += ' background-fixed';
		}
	} );

	// If navigation menu is present on page, adjust it on scroll and screen resize.
	if ( $navigation.length ) {

		// On scroll, we want to stick/unstick the navigation.
		$( window ).on( 'scroll', function() {
			adjustScrollClass();
			adjustHeaderHeight();
		});

		// Also want to make sure the navigation is where it should be on resize.
		$( window ).on( 'resize', function() {
			setNavProps();
			setTimeout( adjustScrollClass, 500 );
		});
	}

	$( window ).on( 'resize', function() {
		clearTimeout( resizeTimer );
		resizeTimer = setTimeout( function() {
			belowEntryMetaClass( 'blockquote.alignleft, blockquote.alignright' );
		}, 300 );
		setTimeout( adjustHeaderHeight, 1000 );
	});

	// Add header video class after the video is loaded.
	$( document ).on( 'wp-custom-header-video-loaded', function() {
		$body.addClass( 'has-header-video' );
	});

})( jQuery );
;
/*!
 * jQuery.scrollTo
 * Copyright (c) 2007 Ariel Flesler - aflesler ○ gmail • com | https://github.com/flesler
 * Licensed under MIT
 * https://github.com/flesler/jquery.scrollTo
 * @projectDescription Lightweight, cross-browser and highly customizable animated scrolling with jQuery
 * @author Ariel Flesler
 * @version 2.1.3
 */
;(function(factory) {
	'use strict';
	if (typeof define === 'function' && define.amd) {
		// AMD
		define(['jquery'], factory);
	} else if (typeof module !== 'undefined' && module.exports) {
		// CommonJS
		module.exports = factory(require('jquery'));
	} else {
		// Global
		factory(jQuery);
	}
})(function($) {
	'use strict';

	var $scrollTo = $.scrollTo = function(target, duration, settings) {
		return $(window).scrollTo(target, duration, settings);
	};

	$scrollTo.defaults = {
		axis:'xy',
		duration: 0,
		limit:true
	};

	function isWin(elem) {
		return !elem.nodeName ||
			$.inArray(elem.nodeName.toLowerCase(), ['iframe','#document','html','body']) !== -1;
	}

	function isFunction(obj) {
		// Brought from jQuery since it's deprecated
		return typeof obj === 'function'
	}

	$.fn.scrollTo = function(target, duration, settings) {
		if (typeof duration === 'object') {
			settings = duration;
			duration = 0;
		}
		if (typeof settings === 'function') {
			settings = { onAfter:settings };
		}
		if (target === 'max') {
			target = 9e9;
		}

		settings = $.extend({}, $scrollTo.defaults, settings);
		// Speed is still recognized for backwards compatibility
		duration = duration || settings.duration;
		// Make sure the settings are given right
		var queue = settings.queue && settings.axis.length > 1;
		if (queue) {
			// Let's keep the overall duration
			duration /= 2;
		}
		settings.offset = both(settings.offset);
		settings.over = both(settings.over);

		return this.each(function() {
			// Null target yields nothing, just like jQuery does
			if (target === null) return;

			var win = isWin(this),
				elem = win ? this.contentWindow || window : this,
				$elem = $(elem),
				targ = target,
				attr = {},
				toff;

			switch (typeof targ) {
				// A number will pass the regex
				case 'number':
				case 'string':
					if (/^([+-]=?)?\d+(\.\d+)?(px|%)?$/.test(targ)) {
						targ = both(targ);
						// We are done
						break;
					}
					// Relative/Absolute selector
					targ = win ? $(targ) : $(targ, elem);
					/* falls through */
				case 'object':
					if (targ.length === 0) return;
					// DOMElement / jQuery
					if (targ.is || targ.style) {
						// Get the real position of the target
						toff = (targ = $(targ)).offset();
					}
			}

			var offset = isFunction(settings.offset) && settings.offset(elem, targ) || settings.offset;

			$.each(settings.axis.split(''), function(i, axis) {
				var Pos	= axis === 'x' ? 'Left' : 'Top',
					pos = Pos.toLowerCase(),
					key = 'scroll' + Pos,
					prev = $elem[key](),
					max = $scrollTo.max(elem, axis);

				if (toff) {// jQuery / DOMElement
					attr[key] = toff[pos] + (win ? 0 : prev - $elem.offset()[pos]);

					// If it's a dom element, reduce the margin
					if (settings.margin) {
						attr[key] -= parseInt(targ.css('margin'+Pos), 10) || 0;
						attr[key] -= parseInt(targ.css('border'+Pos+'Width'), 10) || 0;
					}

					attr[key] += offset[pos] || 0;

					if (settings.over[pos]) {
						// Scroll to a fraction of its width/height
						attr[key] += targ[axis === 'x'?'width':'height']() * settings.over[pos];
					}
				} else {
					var val = targ[pos];
					// Handle percentage values
					attr[key] = val.slice && val.slice(-1) === '%' ?
						parseFloat(val) / 100 * max
						: val;
				}

				// Number or 'number'
				if (settings.limit && /^\d+$/.test(attr[key])) {
					// Check the limits
					attr[key] = attr[key] <= 0 ? 0 : Math.min(attr[key], max);
				}

				// Don't waste time animating, if there's no need.
				if (!i && settings.axis.length > 1) {
					if (prev === attr[key]) {
						// No animation needed
						attr = {};
					} else if (queue) {
						// Intermediate animation
						animate(settings.onAfterFirst);
						// Don't animate this axis again in the next iteration.
						attr = {};
					}
				}
			});

			animate(settings.onAfter);

			function animate(callback) {
				var opts = $.extend({}, settings, {
					// The queue setting conflicts with animate()
					// Force it to always be true
					queue: true,
					duration: duration,
					complete: callback && function() {
						callback.call(elem, targ, settings);
					}
				});
				$elem.animate(attr, opts);
			}
		});
	};

	// Max scrolling position, works on quirks mode
	// It only fails (not too badly) on IE, quirks mode.
	$scrollTo.max = function(elem, axis) {
		var Dim = axis === 'x' ? 'Width' : 'Height',
			scroll = 'scroll'+Dim;

		if (!isWin(elem))
			return elem[scroll] - $(elem)[Dim.toLowerCase()]();

		var size = 'client' + Dim,
			doc = elem.ownerDocument || elem.document,
			html = doc.documentElement,
			body = doc.body;

		return Math.max(html[scroll], body[scroll]) - Math.min(html[size], body[size]);
	};

	function both(val) {
		return isFunction(val) || $.isPlainObject(val) ? val : { top:val, left:val };
	}

	// Add special hooks so that window scroll properties can be animated
	$.Tween.propHooks.scrollLeft =
	$.Tween.propHooks.scrollTop = {
		get: function(t) {
			return $(t.elem)[t.prop]();
		},
		set: function(t) {
			var curr = this.get(t);
			// If interrupt is true and user scrolled, stop animating
			if (t.options.interrupt && t._last && t._last !== curr) {
				return $(t.elem).stop();
			}
			var next = Math.round(t.now);
			// Don't waste CPU
			// Browsers don't render floating point scroll
			if (curr !== next) {
				$(t.elem)[t.prop](next);
				t._last = this.get(t);
			}
		}
	};

	// AMD requirement
	return $scrollTo;
});
;
/*! This file is auto-generated */
window.addComment=function(v){var I,C,h,E=v.document,b={commentReplyClass:"comment-reply-link",commentReplyTitleId:"reply-title",cancelReplyId:"cancel-comment-reply-link",commentFormId:"commentform",temporaryFormId:"wp-temp-form-div",parentIdFieldId:"comment_parent",postIdFieldId:"comment_post_ID"},e=v.MutationObserver||v.WebKitMutationObserver||v.MozMutationObserver,i="querySelector"in E&&"addEventListener"in v,n=!!E.documentElement.dataset;function t(){o(),e&&new e(d).observe(E.body,{childList:!0,subtree:!0})}function o(e){if(i&&(I=g(b.cancelReplyId),C=g(b.commentFormId),I)){I.addEventListener("click",l);function t(e){if((e.metaKey||e.ctrlKey)&&13===e.keyCode&&"a"!==E.activeElement.tagName.toLowerCase())return C.removeEventListener("keydown",t),e.preventDefault(),C.submit.click(),!1}C&&C.addEventListener("keydown",t);for(var n=function(e){var t=b.commentReplyClass;e&&e.childNodes||(e=E);e=E.getElementsByClassName?e.getElementsByClassName(t):e.querySelectorAll("."+t);return e}(e),o=0,d=n.length;o<d;o++)n[o].addEventListener("click",r)}}function l(e){var t,n,o=g(b.temporaryFormId);o&&h&&(g(b.parentIdFieldId).value="0",t=o.textContent,o.parentNode.replaceChild(h,o),this.style.display="none",n=(o=(o=g(b.commentReplyTitleId))&&o.firstChild)&&o.nextSibling,o&&o.nodeType===Node.TEXT_NODE&&t&&(n&&"A"===n.nodeName&&n.id!==b.cancelReplyId&&(n.style.display=""),o.textContent=t),e.preventDefault())}function r(e){var t=g(b.commentReplyTitleId),t=t&&t.firstChild.textContent,n=this,o=a(n,"belowelement"),d=a(n,"commentid"),i=a(n,"respondelement"),l=a(n,"postid"),n=a(n,"replyto")||t;o&&d&&i&&l&&!1===v.addComment.moveForm(o,d,i,l,n)&&e.preventDefault()}function d(e){for(var t=e.length;t--;)if(e[t].addedNodes.length)return void o()}function a(e,t){return n?e.dataset[t]:e.getAttribute("data-"+t)}function g(e){return E.getElementById(e)}return i&&"loading"!==E.readyState?t():i&&v.addEventListener("DOMContentLoaded",t,!1),{init:o,moveForm:function(e,t,n,o,d){var i,l,r,a,m,c,s,e=g(e),n=(h=g(n),g(b.parentIdFieldId)),y=g(b.postIdFieldId),p=g(b.commentReplyTitleId),u=(p=p&&p.firstChild)&&p.nextSibling;if(e&&h&&n){void 0===d&&(d=p&&p.textContent),a=h,m=b.temporaryFormId,c=g(m),s=(s=g(b.commentReplyTitleId))?s.firstChild.textContent:"",c||((c=E.createElement("div")).id=m,c.style.display="none",c.textContent=s,a.parentNode.insertBefore(c,a)),o&&y&&(y.value=o),n.value=t,I.style.display="",e.parentNode.insertBefore(h,e.nextSibling),p&&p.nodeType===Node.TEXT_NODE&&(u&&"A"===u.nodeName&&u.id!==b.cancelReplyId&&(u.style.display="none"),p.textContent=d),I.onclick=function(){return!1};try{for(var f=0;f<C.elements.length;f++)if(i=C.elements[f],l=!1,"getComputedStyle"in v?r=v.getComputedStyle(i):E.documentElement.currentStyle&&(r=i.currentStyle),(i.offsetWidth<=0&&i.offsetHeight<=0||"hidden"===r.visibility)&&(l=!0),"hidden"!==i.type&&!i.disabled&&!l){i.focus();break}}catch(e){}return!1}}}}(window);;
/**
 * core-js 3.39.0
 * © 2014-2024 Denis Pushkarev (zloirock.ru)
 * license: https://github.com/zloirock/core-js/blob/v3.39.0/LICENSE
 * source: https://github.com/zloirock/core-js
 */
!function(r){"use strict";var t,e,n;t=[function(r,t,e){e(1),e(71),e(72),e(85),e(109),r.exports=e(111)},function(t,e,n){var o=n(2),a=n(3),c=n(67),i=n(68),u=n(69),s=n(29),f=n(70),p=a.Promise,l=!1;o({target:"Promise",stat:!0,forced:!p||!p.try||f(function(){p.try(function(r){l=8===r},8)}).error||!l},{try:function(t){var e=arguments.length>1?i(arguments,1):[],n=u.f(this),o=f(function(){return c(s(t),r,e)});return(o.error?n.reject:n.resolve)(o.value),n.promise}})},function(t,e,n){var o=n(3),a=n(4).f,c=n(42),i=n(46),u=n(36),s=n(54),f=n(66);t.exports=function(t,e){var n,p,l,y,v,h=t.target,b=t.global,g=t.stat;if(n=b?o:g?o[h]||u(h,{}):o[h]&&o[h].prototype)for(p in e){if(y=e[p],l=t.dontCallGetSet?(v=a(n,p))&&v.value:n[p],!f(b?p:h+(g?".":"#")+p,t.forced)&&l!==r){if(typeof y==typeof l)continue;s(y,l)}(t.sham||l&&l.sham)&&c(y,"sham",!0),i(n,p,y,t)}}},function(r,t,e){var n=function(r){return r&&r.Math===Math&&r};r.exports=n("object"==typeof globalThis&&globalThis)||n("object"==typeof window&&window)||n("object"==typeof self&&self)||n("object"==typeof global&&global)||n("object"==typeof this&&this)||function(){return this}()||Function("return this")()},function(r,t,e){var n=e(5),o=e(7),a=e(9),c=e(10),i=e(11),u=e(17),s=e(37),f=e(40),p=Object.getOwnPropertyDescriptor;t.f=n?p:function(r,t){if(r=i(r),t=u(t),f)try{return p(r,t)}catch(r){}if(s(r,t))return c(!o(a.f,r,t),r[t])}},function(r,t,e){var n=e(6);r.exports=!n(function(){return 7!==Object.defineProperty({},1,{get:function(){return 7}})[1]})},function(r,t,e){r.exports=function(r){try{return!!r()}catch(r){return!0}}},function(r,t,e){var n=e(8),o=Function.prototype.call;r.exports=n?o.bind(o):function(){return o.apply(o,arguments)}},function(r,t,e){var n=e(6);r.exports=!n(function(){var r=function(){}.bind();return"function"!=typeof r||r.hasOwnProperty("prototype")})},function(r,t,e){var n={}.propertyIsEnumerable,o=Object.getOwnPropertyDescriptor,a=o&&!n.call({1:2},1);t.f=a?function(r){var t=o(this,r);return!!t&&t.enumerable}:n},function(r,t,e){r.exports=function(r,t){return{enumerable:!(1&r),configurable:!(2&r),writable:!(4&r),value:t}}},function(r,t,e){var n=e(12),o=e(15);r.exports=function(r){return n(o(r))}},function(r,t,e){var n=e(13),o=e(6),a=e(14),c=Object,i=n("".split);r.exports=o(function(){return!c("z").propertyIsEnumerable(0)})?function(r){return"String"===a(r)?i(r,""):c(r)}:c},function(r,t,e){var n=e(8),o=Function.prototype,a=o.call,c=n&&o.bind.bind(a,a);r.exports=n?c:function(r){return function(){return a.apply(r,arguments)}}},function(r,t,e){var n=e(13),o=n({}.toString),a=n("".slice);r.exports=function(r){return a(o(r),8,-1)}},function(r,t,e){var n=e(16),o=TypeError;r.exports=function(r){if(n(r))throw new o("Can't call method on "+r);return r}},function(t,e,n){t.exports=function(t){return null===t||t===r}},function(r,t,e){var n=e(18),o=e(21);r.exports=function(r){var t=n(r,"string");return o(t)?t:t+""}},function(t,e,n){var o=n(7),a=n(19),c=n(21),i=n(28),u=n(31),s=n(32),f=TypeError,p=s("toPrimitive");t.exports=function(t,e){if(!a(t)||c(t))return t;var n,s=i(t,p);if(s){if(e===r&&(e="default"),n=o(s,t,e),!a(n)||c(n))return n;throw new f("Can't convert object to primitive value")}return e===r&&(e="number"),u(t,e)}},function(r,t,e){var n=e(20);r.exports=function(r){return"object"==typeof r?null!==r:n(r)}},function(t,e,n){var o="object"==typeof document&&document.all;t.exports=void 0===o&&o!==r?function(r){return"function"==typeof r||r===o}:function(r){return"function"==typeof r}},function(r,t,e){var n=e(22),o=e(20),a=e(23),c=e(24),i=Object;r.exports=c?function(r){return"symbol"==typeof r}:function(r){var t=n("Symbol");return o(t)&&a(t.prototype,i(r))}},function(t,e,n){var o=n(3),a=n(20);t.exports=function(t,e){return arguments.length<2?(n=o[t],a(n)?n:r):o[t]&&o[t][e];var n}},function(r,t,e){var n=e(13);r.exports=n({}.isPrototypeOf)},function(r,t,e){var n=e(25);r.exports=n&&!Symbol.sham&&"symbol"==typeof Symbol.iterator},function(r,t,e){var n=e(26),o=e(6),a=e(3).String;r.exports=!!Object.getOwnPropertySymbols&&!o(function(){var r=Symbol("symbol detection");return!a(r)||!(Object(r)instanceof Symbol)||!Symbol.sham&&n&&n<41})},function(r,t,e){var n,o,a=e(3),c=e(27),i=a.process,u=a.Deno,s=i&&i.versions||u&&u.version,f=s&&s.v8;f&&(o=(n=f.split("."))[0]>0&&n[0]<4?1:+(n[0]+n[1])),!o&&c&&(!(n=c.match(/Edge\/(\d+)/))||n[1]>=74)&&(n=c.match(/Chrome\/(\d+)/))&&(o=+n[1]),r.exports=o},function(r,t,e){var n=e(3).navigator,o=n&&n.userAgent;r.exports=o?String(o):""},function(t,e,n){var o=n(29),a=n(16);t.exports=function(t,e){var n=t[e];return a(n)?r:o(n)}},function(r,t,e){var n=e(20),o=e(30),a=TypeError;r.exports=function(r){if(n(r))return r;throw new a(o(r)+" is not a function")}},function(r,t,e){var n=String;r.exports=function(r){try{return n(r)}catch(r){return"Object"}}},function(r,t,e){var n=e(7),o=e(20),a=e(19),c=TypeError;r.exports=function(r,t){var e,i;if("string"===t&&o(e=r.toString)&&!a(i=n(e,r)))return i;if(o(e=r.valueOf)&&!a(i=n(e,r)))return i;if("string"!==t&&o(e=r.toString)&&!a(i=n(e,r)))return i;throw new c("Can't convert object to primitive value")}},function(r,t,e){var n=e(3),o=e(33),a=e(37),c=e(39),i=e(25),u=e(24),s=n.Symbol,f=o("wks"),p=u?s.for||s:s&&s.withoutSetter||c;r.exports=function(r){return a(f,r)||(f[r]=i&&a(s,r)?s[r]:p("Symbol."+r)),f[r]}},function(r,t,e){var n=e(34);r.exports=function(r,t){return n[r]||(n[r]=t||{})}},function(r,t,e){var n=e(35),o=e(3),a=e(36),c="__core-js_shared__",i=r.exports=o[c]||a(c,{});(i.versions||(i.versions=[])).push({version:"3.39.0",mode:n?"pure":"global",copyright:"© 2014-2024 Denis Pushkarev (zloirock.ru)",license:"https://github.com/zloirock/core-js/blob/v3.39.0/LICENSE",source:"https://github.com/zloirock/core-js"})},function(r,t,e){r.exports=!1},function(r,t,e){var n=e(3),o=Object.defineProperty;r.exports=function(r,t){try{o(n,r,{value:t,configurable:!0,writable:!0})}catch(e){n[r]=t}return t}},function(r,t,e){var n=e(13),o=e(38),a=n({}.hasOwnProperty);r.exports=Object.hasOwn||function(r,t){return a(o(r),t)}},function(r,t,e){var n=e(15),o=Object;r.exports=function(r){return o(n(r))}},function(t,e,n){var o=n(13),a=0,c=Math.random(),i=o(1..toString);t.exports=function(t){return"Symbol("+(t===r?"":t)+")_"+i(++a+c,36)}},function(r,t,e){var n=e(5),o=e(6),a=e(41);r.exports=!n&&!o(function(){return 7!==Object.defineProperty(a("div"),"a",{get:function(){return 7}}).a})},function(r,t,e){var n=e(3),o=e(19),a=n.document,c=o(a)&&o(a.createElement);r.exports=function(r){return c?a.createElement(r):{}}},function(r,t,e){var n=e(5),o=e(43),a=e(10);r.exports=n?function(r,t,e){return o.f(r,t,a(1,e))}:function(r,t,e){return r[t]=e,r}},function(r,t,e){var n=e(5),o=e(40),a=e(44),c=e(45),i=e(17),u=TypeError,s=Object.defineProperty,f=Object.getOwnPropertyDescriptor,p="enumerable",l="configurable",y="writable";t.f=n?a?function(r,t,e){if(c(r),t=i(t),c(e),"function"==typeof r&&"prototype"===t&&"value"in e&&y in e&&!e[y]){var n=f(r,t);n&&n[y]&&(r[t]=e.value,e={configurable:l in e?e[l]:n[l],enumerable:p in e?e[p]:n[p],writable:!1})}return s(r,t,e)}:s:function(r,t,e){if(c(r),t=i(t),c(e),o)try{return s(r,t,e)}catch(r){}if("get"in e||"set"in e)throw new u("Accessors not supported");return"value"in e&&(r[t]=e.value),r}},function(r,t,e){var n=e(5),o=e(6);r.exports=n&&o(function(){return 42!==Object.defineProperty(function(){},"prototype",{value:42,writable:!1}).prototype})},function(r,t,e){var n=e(19),o=String,a=TypeError;r.exports=function(r){if(n(r))return r;throw new a(o(r)+" is not an object")}},function(t,e,n){var o=n(20),a=n(43),c=n(47),i=n(36);t.exports=function(t,e,n,u){u||(u={});var s=u.enumerable,f=u.name!==r?u.name:e;if(o(n)&&c(n,f,u),u.global)s?t[e]=n:i(e,n);else{try{u.unsafe?t[e]&&(s=!0):delete t[e]}catch(r){}s?t[e]=n:a.f(t,e,{value:n,enumerable:!1,configurable:!u.nonConfigurable,writable:!u.nonWritable})}return t}},function(t,e,n){var o=n(13),a=n(6),c=n(20),i=n(37),u=n(5),s=n(48).CONFIGURABLE,f=n(49),p=n(50),l=p.enforce,y=p.get,v=String,h=Object.defineProperty,b=o("".slice),g=o("".replace),m=o([].join),E=u&&!a(function(){return 8!==h(function(){},"length",{value:8}).length}),d=String(String).split("String"),w=t.exports=function(t,e,n){"Symbol("===b(v(e),0,7)&&(e="["+g(v(e),/^Symbol\(([^)]*)\).*$/,"$1")+"]"),n&&n.getter&&(e="get "+e),n&&n.setter&&(e="set "+e),(!i(t,"name")||s&&t.name!==e)&&(u?h(t,"name",{value:e,configurable:!0}):t.name=e),E&&n&&i(n,"arity")&&t.length!==n.arity&&h(t,"length",{value:n.arity});try{n&&i(n,"constructor")&&n.constructor?u&&h(t,"prototype",{writable:!1}):t.prototype&&(t.prototype=r)}catch(r){}var o=l(t);return i(o,"source")||(o.source=m(d,"string"==typeof e?e:"")),t};Function.prototype.toString=w(function(){return c(this)&&y(this).source||f(this)},"toString")},function(r,t,e){var n=e(5),o=e(37),a=Function.prototype,c=n&&Object.getOwnPropertyDescriptor,i=o(a,"name"),u=i&&"something"===function(){}.name,s=i&&(!n||n&&c(a,"name").configurable);r.exports={EXISTS:i,PROPER:u,CONFIGURABLE:s}},function(r,t,e){var n=e(13),o=e(20),a=e(34),c=n(Function.toString);o(a.inspectSource)||(a.inspectSource=function(r){return c(r)}),r.exports=a.inspectSource},function(r,t,e){var n,o,a,c=e(51),i=e(3),u=e(19),s=e(42),f=e(37),p=e(34),l=e(52),y=e(53),v="Object already initialized",h=i.TypeError,b=i.WeakMap;if(c||p.state){var g=p.state||(p.state=new b);g.get=g.get,g.has=g.has,g.set=g.set,n=function(r,t){if(g.has(r))throw new h(v);return t.facade=r,g.set(r,t),t},o=function(r){return g.get(r)||{}},a=function(r){return g.has(r)}}else{var m=l("state");y[m]=!0,n=function(r,t){if(f(r,m))throw new h(v);return t.facade=r,s(r,m,t),t},o=function(r){return f(r,m)?r[m]:{}},a=function(r){return f(r,m)}}r.exports={set:n,get:o,has:a,enforce:function(r){return a(r)?o(r):n(r,{})},getterFor:function(r){return function(t){var e;if(!u(t)||(e=o(t)).type!==r)throw new h("Incompatible receiver, "+r+" required");return e}}}},function(r,t,e){var n=e(3),o=e(20),a=n.WeakMap;r.exports=o(a)&&/native code/.test(String(a))},function(r,t,e){var n=e(33),o=e(39),a=n("keys");r.exports=function(r){return a[r]||(a[r]=o(r))}},function(r,t,e){r.exports={}},function(r,t,e){var n=e(37),o=e(55),a=e(4),c=e(43);r.exports=function(r,t,e){for(var i=o(t),u=c.f,s=a.f,f=0;f<i.length;f++){var p=i[f];n(r,p)||e&&n(e,p)||u(r,p,s(t,p))}}},function(r,t,e){var n=e(22),o=e(13),a=e(56),c=e(65),i=e(45),u=o([].concat);r.exports=n("Reflect","ownKeys")||function(r){var t=a.f(i(r)),e=c.f;return e?u(t,e(r)):t}},function(r,t,e){var n=e(57),o=e(64).concat("length","prototype");t.f=Object.getOwnPropertyNames||function(r){return n(r,o)}},function(r,t,e){var n=e(13),o=e(37),a=e(11),c=e(58).indexOf,i=e(53),u=n([].push);r.exports=function(r,t){var e,n=a(r),s=0,f=[];for(e in n)!o(i,e)&&o(n,e)&&u(f,e);for(;t.length>s;)o(n,e=t[s++])&&(~c(f,e)||u(f,e));return f}},function(r,t,e){var n=e(11),o=e(59),a=e(62),c=function(r){return function(t,e,c){var i=n(t),u=a(i);if(0===u)return!r&&-1;var s,f=o(c,u);if(r&&e!=e){for(;u>f;)if((s=i[f++])!=s)return!0}else for(;u>f;f++)if((r||f in i)&&i[f]===e)return r||f||0;return!r&&-1}};r.exports={includes:c(!0),indexOf:c(!1)}},function(r,t,e){var n=e(60),o=Math.max,a=Math.min;r.exports=function(r,t){var e=n(r);return e<0?o(e+t,0):a(e,t)}},function(r,t,e){var n=e(61);r.exports=function(r){var t=+r;return t!=t||0===t?0:n(t)}},function(r,t,e){var n=Math.ceil,o=Math.floor;r.exports=Math.trunc||function(r){var t=+r;return(t>0?o:n)(t)}},function(r,t,e){var n=e(63);r.exports=function(r){return n(r.length)}},function(r,t,e){var n=e(60),o=Math.min;r.exports=function(r){var t=n(r);return t>0?o(t,9007199254740991):0}},function(r,t,e){r.exports=["constructor","hasOwnProperty","isPrototypeOf","propertyIsEnumerable","toLocaleString","toString","valueOf"]},function(r,t,e){t.f=Object.getOwnPropertySymbols},function(r,t,e){var n=e(6),o=e(20),a=/#|\.prototype\./,c=function(r,t){var e=u[i(r)];return e===f||e!==s&&(o(t)?n(t):!!t)},i=c.normalize=function(r){return String(r).replace(a,".").toLowerCase()},u=c.data={},s=c.NATIVE="N",f=c.POLYFILL="P";r.exports=c},function(r,t,e){var n=e(8),o=Function.prototype,a=o.apply,c=o.call;r.exports="object"==typeof Reflect&&Reflect.apply||(n?c.bind(a):function(){return c.apply(a,arguments)})},function(r,t,e){var n=e(13);r.exports=n([].slice)},function(t,e,n){var o=n(29),a=TypeError,c=function(t){var e,n;this.promise=new t(function(t,o){if(e!==r||n!==r)throw new a("Bad Promise constructor");e=t,n=o}),this.resolve=o(e),this.reject=o(n)};t.exports.f=function(r){return new c(r)}},function(r,t,e){r.exports=function(r){try{return{error:!1,value:r()}}catch(r){return{error:!0,value:r}}}},function(r,t,e){var n=e(2),o=e(69);n({target:"Promise",stat:!0},{withResolvers:function(){var r=o.f(this);return{promise:r.promise,resolve:r.resolve,reject:r.reject}}})},function(t,e,n){var o=n(2),a=n(3),c=n(22),i=n(10),u=n(43).f,s=n(37),f=n(73),p=n(74),l=n(79),y=n(83),v=n(84),h=n(5),b=n(35),g="DOMException",m=c("Error"),E=c(g),d=function(){f(this,w);var t=arguments.length,e=l(t<1?r:arguments[0]),n=l(t<2?r:arguments[1],"Error"),o=new E(e,n),a=new m(e);return a.name=g,u(o,"stack",i(1,v(a.stack,1))),p(o,this,d),o},w=d.prototype=E.prototype,x="stack"in new m(g),O="stack"in new E(1,2),R=E&&h&&Object.getOwnPropertyDescriptor(a,g),S=!(!R||R.writable&&R.configurable),A=x&&!S&&!O;o({global:!0,constructor:!0,forced:b||A},{DOMException:A?d:E});var D=c(g),T=D.prototype;if(T.constructor!==D)for(var _ in b||u(T,"constructor",i(1,D)),y)if(s(y,_)){var I=y[_],j=I.s;s(D,j)||u(D,j,i(6,I.c))}},function(r,t,e){var n=e(23),o=TypeError;r.exports=function(r,t){if(n(t,r))return r;throw new o("Incorrect invocation")}},function(r,t,e){var n=e(20),o=e(19),a=e(75);r.exports=function(r,t,e){var c,i;return a&&n(c=t.constructor)&&c!==e&&o(i=c.prototype)&&i!==e.prototype&&a(r,i),r}},function(t,e,n){var o=n(76),a=n(19),c=n(15),i=n(77);t.exports=Object.setPrototypeOf||("__proto__"in{}?function(){var r,t=!1,e={};try{(r=o(Object.prototype,"__proto__","set"))(e,[]),t=e instanceof Array}catch(r){}return function(e,n){return c(e),i(n),a(e)?(t?r(e,n):e.__proto__=n,e):e}}():r)},function(r,t,e){var n=e(13),o=e(29);r.exports=function(r,t,e){try{return n(o(Object.getOwnPropertyDescriptor(r,t)[e]))}catch(r){}}},function(r,t,e){var n=e(78),o=String,a=TypeError;r.exports=function(r){if(n(r))return r;throw new a("Can't set "+o(r)+" as a prototype")}},function(r,t,e){var n=e(19);r.exports=function(r){return n(r)||null===r}},function(t,e,n){var o=n(80);t.exports=function(t,e){return t===r?arguments.length<2?"":e:o(t)}},function(r,t,e){var n=e(81),o=String;r.exports=function(r){if("Symbol"===n(r))throw new TypeError("Cannot convert a Symbol value to a string");return o(r)}},function(t,e,n){var o=n(82),a=n(20),c=n(14),i=n(32)("toStringTag"),u=Object,s="Arguments"===c(function(){return arguments}());t.exports=o?c:function(t){var e,n,o;return t===r?"Undefined":null===t?"Null":"string"==typeof(n=function(r,t){try{return r[t]}catch(r){}}(e=u(t),i))?n:s?c(e):"Object"===(o=c(e))&&a(e.callee)?"Arguments":o}},function(r,t,e){var n={};n[e(32)("toStringTag")]="z",r.exports="[object z]"===String(n)},function(r,t,e){r.exports={IndexSizeError:{s:"INDEX_SIZE_ERR",c:1,m:1},DOMStringSizeError:{s:"DOMSTRING_SIZE_ERR",c:2,m:0},HierarchyRequestError:{s:"HIERARCHY_REQUEST_ERR",c:3,m:1},WrongDocumentError:{s:"WRONG_DOCUMENT_ERR",c:4,m:1},InvalidCharacterError:{s:"INVALID_CHARACTER_ERR",c:5,m:1},NoDataAllowedError:{s:"NO_DATA_ALLOWED_ERR",c:6,m:0},NoModificationAllowedError:{s:"NO_MODIFICATION_ALLOWED_ERR",c:7,m:1},NotFoundError:{s:"NOT_FOUND_ERR",c:8,m:1},NotSupportedError:{s:"NOT_SUPPORTED_ERR",c:9,m:1},InUseAttributeError:{s:"INUSE_ATTRIBUTE_ERR",c:10,m:1},InvalidStateError:{s:"INVALID_STATE_ERR",c:11,m:1},SyntaxError:{s:"SYNTAX_ERR",c:12,m:1},InvalidModificationError:{s:"INVALID_MODIFICATION_ERR",c:13,m:1},NamespaceError:{s:"NAMESPACE_ERR",c:14,m:1},InvalidAccessError:{s:"INVALID_ACCESS_ERR",c:15,m:1},ValidationError:{s:"VALIDATION_ERR",c:16,m:0},TypeMismatchError:{s:"TYPE_MISMATCH_ERR",c:17,m:1},SecurityError:{s:"SECURITY_ERR",c:18,m:1},NetworkError:{s:"NETWORK_ERR",c:19,m:1},AbortError:{s:"ABORT_ERR",c:20,m:1},URLMismatchError:{s:"URL_MISMATCH_ERR",c:21,m:1},QuotaExceededError:{s:"QUOTA_EXCEEDED_ERR",c:22,m:1},TimeoutError:{s:"TIMEOUT_ERR",c:23,m:1},InvalidNodeTypeError:{s:"INVALID_NODE_TYPE_ERR",c:24,m:1},DataCloneError:{s:"DATA_CLONE_ERR",c:25,m:1}}},function(r,t,e){var n=e(13),o=Error,a=n("".replace),c=String(new o("zxcasd").stack),i=/\n\s*at [^:]*:[^\n]*/,u=i.test(c);r.exports=function(r,t){if(u&&"string"==typeof r&&!o.prepareStackTrace)for(;t--;)r=a(r,i,"");return r}},function(t,e,n){var o,a=n(35),c=n(2),i=n(3),u=n(22),s=n(13),f=n(6),p=n(39),l=n(20),y=n(86),v=n(16),h=n(19),b=n(21),g=n(87),m=n(45),E=n(81),d=n(37),w=n(95),x=n(42),O=n(62),R=n(96),S=n(97),A=n(99),D=n(100),T=n(101),_=n(103),I=n(108),j=n(107),M=i.Object,k=i.Array,P=i.Date,C=i.Error,N=i.TypeError,L=i.PerformanceMark,U=u("DOMException"),B=A.Map,F=A.has,W=A.get,z=A.set,V=D.Set,H=D.add,G=D.has,Y=u("Object","keys"),Q=s([].push),q=s((!0).valueOf),X=s(1..valueOf),K=s("".valueOf),Z=s(P.prototype.getTime),$=p("structuredClone"),J="DataCloneError",rr="Transferring",tr=function(r){return!f(function(){var t=new i.Set([7]),e=r(t),n=r(M(7));return e===t||!e.has(7)||!h(n)||7!==+n})&&r},er=function(r,t){return!f(function(){var e=new t,n=r({a:e,b:e});return!(n&&n.a===n.b&&n.a instanceof t&&n.a.stack===e.stack)})},nr=i.structuredClone,or=a||!er(nr,C)||!er(nr,U)||(o=nr,!!f(function(){var r=o(new i.AggregateError([1],$,{cause:3}));return"AggregateError"!==r.name||1!==r.errors[0]||r.message!==$||3!==r.cause})),ar=!nr&&tr(function(r){return new L($,{detail:r}).detail}),cr=tr(nr)||ar,ir=function(r){throw new U("Uncloneable type: "+r,J)},ur=function(r,t){throw new U((t||"Cloning")+" of "+r+" cannot be properly polyfilled in this engine",J)},sr=function(r,t){return cr||ur(t),cr(r)},fr=function(t,e,n){if(F(e,t))return W(e,t);var o,a,c,u,s,f;if("SharedArrayBuffer"===(n||E(t)))o=cr?cr(t):t;else{var p=i.DataView;p||l(t.slice)||ur("ArrayBuffer");try{if(l(t.slice)&&!t.resizable)o=t.slice(0);else{a=t.byteLength,c="maxByteLength"in t?{maxByteLength:t.maxByteLength}:r,o=new ArrayBuffer(a,c),u=new p(t),s=new p(o);for(f=0;f<a;f++)s.setUint8(f,u.getUint8(f))}}catch(r){throw new U("ArrayBuffer is detached",J)}}return z(e,t,o),o},pr=function(t,e){if(b(t)&&ir("Symbol"),!h(t))return t;if(e){if(F(e,t))return W(e,t)}else e=new B;var n,o,a,c,s,f,p,y,v=E(t);switch(v){case"Array":a=k(O(t));break;case"Object":a={};break;case"Map":a=new B;break;case"Set":a=new V;break;case"RegExp":a=new RegExp(t.source,S(t));break;case"Error":switch(o=t.name){case"AggregateError":a=new(u(o))([]);break;case"EvalError":case"RangeError":case"ReferenceError":case"SuppressedError":case"SyntaxError":case"TypeError":case"URIError":a=new(u(o));break;case"CompileError":case"LinkError":case"RuntimeError":a=new(u("WebAssembly",o));break;default:a=new C}break;case"DOMException":a=new U(t.message,t.name);break;case"ArrayBuffer":case"SharedArrayBuffer":a=fr(t,e,v);break;case"DataView":case"Int8Array":case"Uint8Array":case"Uint8ClampedArray":case"Int16Array":case"Uint16Array":case"Int32Array":case"Uint32Array":case"Float16Array":case"Float32Array":case"Float64Array":case"BigInt64Array":case"BigUint64Array":f="DataView"===v?t.byteLength:t.length,a=function(r,t,e,n,o){var a=i[t];return h(a)||ur(t),new a(fr(r.buffer,o),e,n)}(t,v,t.byteOffset,f,e);break;case"DOMQuad":try{a=new DOMQuad(pr(t.p1,e),pr(t.p2,e),pr(t.p3,e),pr(t.p4,e))}catch(r){a=sr(t,v)}break;case"File":if(cr)try{a=cr(t),E(a)!==v&&(a=r)}catch(r){}if(!a)try{a=new File([t],t.name,t)}catch(r){}a||ur(v);break;case"FileList":if(c=function(){var r;try{r=new i.DataTransfer}catch(t){try{r=new i.ClipboardEvent("").clipboardData}catch(r){}}return r&&r.items&&r.files?r:null}()){for(s=0,f=O(t);s<f;s++)c.items.add(pr(t[s],e));a=c.files}else a=sr(t,v);break;case"ImageData":try{a=new ImageData(pr(t.data,e),t.width,t.height,{colorSpace:t.colorSpace})}catch(r){a=sr(t,v)}break;default:if(cr)a=cr(t);else switch(v){case"BigInt":a=M(t.valueOf());break;case"Boolean":a=M(q(t));break;case"Number":a=M(X(t));break;case"String":a=M(K(t));break;case"Date":a=new P(Z(t));break;case"Blob":try{a=t.slice(0,t.size,t.type)}catch(r){ur(v)}break;case"DOMPoint":case"DOMPointReadOnly":n=i[v];try{a=n.fromPoint?n.fromPoint(t):new n(t.x,t.y,t.z,t.w)}catch(r){ur(v)}break;case"DOMRect":case"DOMRectReadOnly":n=i[v];try{a=n.fromRect?n.fromRect(t):new n(t.x,t.y,t.width,t.height)}catch(r){ur(v)}break;case"DOMMatrix":case"DOMMatrixReadOnly":n=i[v];try{a=n.fromMatrix?n.fromMatrix(t):new n(t)}catch(r){ur(v)}break;case"AudioData":case"VideoFrame":l(t.clone)||ur(v);try{a=t.clone()}catch(r){ir(v)}break;case"CropTarget":case"CryptoKey":case"FileSystemDirectoryHandle":case"FileSystemFileHandle":case"FileSystemHandle":case"GPUCompilationInfo":case"GPUCompilationMessage":case"ImageBitmap":case"RTCCertificate":case"WebAssembly.Module":ur(v);default:ir(v)}}switch(z(e,t,a),v){case"Array":case"Object":for(p=Y(t),s=0,f=O(p);s<f;s++)y=p[s],w(a,y,pr(t[y],e));break;case"Map":t.forEach(function(r,t){z(a,pr(t,e),pr(r,e))});break;case"Set":t.forEach(function(r){H(a,pr(r,e))});break;case"Error":x(a,"message",pr(t.message,e)),d(t,"cause")&&x(a,"cause",pr(t.cause,e)),"AggregateError"===o?a.errors=pr(t.errors,e):"SuppressedError"===o&&(a.error=pr(t.error,e),a.suppressed=pr(t.suppressed,e));case"DOMException":I&&x(a,"stack",pr(t.stack,e))}return a};c({global:!0,enumerable:!0,sham:!j,forced:or},{structuredClone:function(t){var e,n,o=R(arguments.length,1)>1&&!v(arguments[1])?m(arguments[1]):r,a=o?o.transfer:r;a!==r&&(n=function(t,e){if(!h(t))throw new N("Transfer option cannot be converted to a sequence");var n=[];g(t,function(r){Q(n,m(r))});for(var o,a,c,u,s,f=0,p=O(n),v=new V;f<p;){if(o=n[f++],"ArrayBuffer"===(a=E(o))?G(v,o):F(e,o))throw new U("Duplicate transferable",J);if("ArrayBuffer"!==a){if(j)u=nr(o,{transfer:[o]});else switch(a){case"ImageBitmap":c=i.OffscreenCanvas,y(c)||ur(a,rr);try{(s=new c(o.width,o.height)).getContext("bitmaprenderer").transferFromImageBitmap(o),u=s.transferToImageBitmap()}catch(r){}break;case"AudioData":case"VideoFrame":l(o.clone)&&l(o.close)||ur(a,rr);try{u=o.clone(),o.close()}catch(r){}break;case"MediaSourceHandle":case"MessagePort":case"MIDIAccess":case"OffscreenCanvas":case"ReadableStream":case"RTCDataChannel":case"TransformStream":case"WebTransportReceiveStream":case"WebTransportSendStream":case"WritableStream":ur(a,rr)}if(u===r)throw new U("This object cannot be transferred: "+a,J);z(e,o,u)}else H(v,o)}return v}(a,e=new B));var c=pr(t,e);return n&&function(r){T(r,function(r){j?cr(r,{transfer:[r]}):l(r.transfer)?r.transfer():_?_(r):ur("ArrayBuffer",rr)})}(n),c}})},function(r,t,e){var n=e(13),o=e(6),a=e(20),c=e(81),i=e(22),u=e(49),s=function(){},f=i("Reflect","construct"),p=/^\s*(?:class|function)\b/,l=n(p.exec),y=!p.test(s),v=function(r){if(!a(r))return!1;try{return f(s,[],r),!0}catch(r){return!1}},h=function(r){if(!a(r))return!1;switch(c(r)){case"AsyncFunction":case"GeneratorFunction":case"AsyncGeneratorFunction":return!1}try{return y||!!l(p,u(r))}catch(r){return!0}};h.sham=!0,r.exports=!f||o(function(){var r;return v(v.call)||!v(Object)||!v(function(){r=!0})||r})?h:v},function(r,t,e){var n=e(88),o=e(7),a=e(45),c=e(30),i=e(90),u=e(62),s=e(23),f=e(92),p=e(93),l=e(94),y=TypeError,v=function(r,t){this.stopped=r,this.result=t},h=v.prototype;r.exports=function(r,t,e){var b,g,m,E,d,w,x,O=e&&e.that,R=!(!e||!e.AS_ENTRIES),S=!(!e||!e.IS_RECORD),A=!(!e||!e.IS_ITERATOR),D=!(!e||!e.INTERRUPTED),T=n(t,O),_=function(r){return b&&l(b,"normal",r),new v(!0,r)},I=function(r){return R?(a(r),D?T(r[0],r[1],_):T(r[0],r[1])):D?T(r,_):T(r)};if(S)b=r.iterator;else if(A)b=r;else{if(!(g=p(r)))throw new y(c(r)+" is not iterable");if(i(g)){for(m=0,E=u(r);E>m;m++)if((d=I(r[m]))&&s(h,d))return d;return new v(!1)}b=f(r,g)}for(w=S?r.next:b.next;!(x=o(w,b)).done;){try{d=I(x.value)}catch(r){l(b,"throw",r)}if("object"==typeof d&&d&&s(h,d))return d}return new v(!1)}},function(t,e,n){var o=n(89),a=n(29),c=n(8),i=o(o.bind);t.exports=function(t,e){return a(t),e===r?t:c?i(t,e):function(){return t.apply(e,arguments)}}},function(r,t,e){var n=e(14),o=e(13);r.exports=function(r){if("Function"===n(r))return o(r)}},function(t,e,n){var o=n(32),a=n(91),c=o("iterator"),i=Array.prototype;t.exports=function(t){return t!==r&&(a.Array===t||i[c]===t)}},function(r,t,e){r.exports={}},function(r,t,e){var n=e(7),o=e(29),a=e(45),c=e(30),i=e(93),u=TypeError;r.exports=function(r,t){var e=arguments.length<2?i(r):t;if(o(e))return a(n(e,r));throw new u(c(r)+" is not iterable")}},function(r,t,e){var n=e(81),o=e(28),a=e(16),c=e(91),i=e(32)("iterator");r.exports=function(r){if(!a(r))return o(r,i)||o(r,"@@iterator")||c[n(r)]}},function(r,t,e){var n=e(7),o=e(45),a=e(28);r.exports=function(r,t,e){var c,i;o(r);try{if(!(c=a(r,"return"))){if("throw"===t)throw e;return e}c=n(c,r)}catch(r){i=!0,c=r}if("throw"===t)throw e;if(i)throw c;return o(c),e}},function(r,t,e){var n=e(5),o=e(43),a=e(10);r.exports=function(r,t,e){n?o.f(r,t,a(0,e)):r[t]=e}},function(r,t,e){var n=TypeError;r.exports=function(r,t){if(r<t)throw new n("Not enough arguments");return r}},function(t,e,n){var o=n(7),a=n(37),c=n(23),i=n(98),u=RegExp.prototype;t.exports=function(t){var e=t.flags;return e!==r||"flags"in u||a(t,"flags")||!c(u,t)?e:o(i,t)}},function(r,t,e){var n=e(45);r.exports=function(){var r=n(this),t="";return r.hasIndices&&(t+="d"),r.global&&(t+="g"),r.ignoreCase&&(t+="i"),r.multiline&&(t+="m"),r.dotAll&&(t+="s"),r.unicode&&(t+="u"),r.unicodeSets&&(t+="v"),r.sticky&&(t+="y"),t}},function(r,t,e){var n=e(13),o=Map.prototype;r.exports={Map:Map,set:n(o.set),get:n(o.get),has:n(o.has),remove:n(o.delete),proto:o}},function(r,t,e){var n=e(13),o=Set.prototype;r.exports={Set:Set,add:n(o.add),has:n(o.has),remove:n(o.delete),proto:o}},function(r,t,e){var n=e(13),o=e(102),a=e(100),c=a.Set,i=a.proto,u=n(i.forEach),s=n(i.keys),f=s(new c).next;r.exports=function(r,t,e){return e?o({iterator:s(r),next:f},t):u(r,t)}},function(t,e,n){var o=n(7);t.exports=function(t,e,n){for(var a,c,i=n?t:t.iterator,u=t.next;!(a=o(u,i)).done;)if((c=e(a.value))!==r)return c}},function(r,t,e){var n,o,a,c,i=e(3),u=e(104),s=e(107),f=i.structuredClone,p=i.ArrayBuffer,l=i.MessageChannel,y=!1;if(s)y=function(r){f(r,{transfer:[r]})};else if(p)try{l||(n=u("worker_threads"))&&(l=n.MessageChannel),l&&(o=new l,a=new p(2),c=function(r){o.port1.postMessage(null,[r])},2===a.byteLength&&(c(a),0===a.byteLength&&(y=c)))}catch(r){}r.exports=y},function(r,t,e){var n=e(3),o=e(105);r.exports=function(r){if(o){try{return n.process.getBuiltinModule(r)}catch(r){}try{return Function('return require("'+r+'")')()}catch(r){}}}},function(r,t,e){var n=e(106);r.exports="NODE"===n},function(r,t,e){var n=e(3),o=e(27),a=e(14),c=function(r){return o.slice(0,r.length)===r};r.exports=c("Bun/")?"BUN":c("Cloudflare-Workers")?"CLOUDFLARE":c("Deno/")?"DENO":c("Node.js/")?"NODE":n.Bun&&"string"==typeof Bun.version?"BUN":n.Deno&&"object"==typeof Deno.version?"DENO":"process"===a(n.process)?"NODE":n.window&&n.document?"BROWSER":"REST"},function(r,t,e){var n=e(3),o=e(6),a=e(26),c=e(106),i=n.structuredClone;r.exports=!!i&&!o(function(){if("DENO"===c&&a>92||"NODE"===c&&a>94||"BROWSER"===c&&a>97)return!1;var r=new ArrayBuffer(8),t=i(r,{transfer:[r]});return 0!==r.byteLength||8!==t.byteLength})},function(r,t,e){var n=e(6),o=e(10);r.exports=!n(function(){var r=new Error("a");return!("stack"in r)||(Object.defineProperty(r,"stack",o(1,7)),7!==r.stack)})},function(t,e,n){var o=n(2),a=n(22),c=n(6),i=n(96),u=n(80),s=n(110),f=a("URL"),p=s&&c(function(){f.canParse()}),l=c(function(){return 1!==f.canParse.length});o({target:"URL",stat:!0,forced:!p||l},{canParse:function(t){var e=i(arguments.length,1),n=u(t),o=e<2||arguments[1]===r?r:u(arguments[1]);try{return!!new f(n,o)}catch(r){return!1}}})},function(t,e,n){var o=n(6),a=n(32),c=n(5),i=n(35),u=a("iterator");t.exports=!o(function(){var t=new URL("b?a=1&b=2&c=3","https://a"),e=t.searchParams,n=new URLSearchParams("a=1&a=2&b=3"),o="";return t.pathname="c%20d",e.forEach(function(r,t){e.delete("b"),o+=t+r}),n.delete("a",2),n.delete("b",r),i&&(!t.toJSON||!n.has("a",1)||n.has("a",2)||!n.has("a",r)||n.has("b"))||!e.size&&(i||!c)||!e.sort||"https://a/c%20d?a=1&c=3"!==t.href||"3"!==e.get("c")||"a=1"!==String(new URLSearchParams("?a=1"))||!e[u]||"a"!==new URL("https://a@b").username||"b"!==new URLSearchParams(new URLSearchParams("a=b")).get("a")||"xn--e1aybc"!==new URL("https://тест").host||"#%D0%B1"!==new URL("https://a#б").hash||"a1c3"!==o||"x"!==new URL("https://x",r).host})},function(t,e,n){var o=n(2),a=n(22),c=n(96),i=n(80),u=n(110),s=a("URL");o({target:"URL",stat:!0,forced:!u},{parse:function(t){var e=c(arguments.length,1),n=i(t),o=e<2||arguments[1]===r?r:i(arguments[1]);try{return new s(n,o)}catch(r){return null}}})}],e={},(n=function(r){if(e[r])return e[r].exports;var o=e[r]={i:r,l:!1,exports:{}};return t[r].call(o.exports,o,o.exports,n),o.l=!0,o.exports}).m=t,n.c=e,n.d=function(r,t,e){n.o(r,t)||Object.defineProperty(r,t,{enumerable:!0,get:e})},n.r=function(r){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(r,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(r,"__esModule",{value:!0})},n.t=function(r,t){if(1&t&&(r=n(r)),8&t)return r;if(4&t&&"object"==typeof r&&r&&r.__esModule)return r;var e=Object.create(null);if(n.r(e),Object.defineProperty(e,"default",{enumerable:!0,value:r}),2&t&&"string"!=typeof r)for(var o in r)n.d(e,o,function(t){return r[t]}.bind(null,o));return e},n.n=function(r){var t=r&&r.__esModule?function(){return r.default}:function(){return r};return n.d(t,"a",t),t},n.o=function(r,t){return Object.prototype.hasOwnProperty.call(r,t)},n.p="",n(n.s=0)}();;
