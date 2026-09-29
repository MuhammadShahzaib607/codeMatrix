(function () {
  'use strict'

  function onReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true })
    } else {
      callback()
    }
  }

  onReady(function () {
    var header = document.querySelector('.site-header')
    var navToggle = document.querySelector('.nav-toggle')
    var siteNav = document.querySelector('.site-nav')
    var backToTop = document.querySelector('.back-to-top')
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    function syncHeaderOffset() {
      var bar = document.querySelector('.site-header, .app-bar, header')
      if (!bar || !document.body) return
      var box = bar.getBoundingClientRect()
      var height = Math.round(box.height)
      if (height > 0) document.documentElement.style.setProperty('--header-offset', height + 'px')
      var position = window.getComputedStyle(bar).position
      var outOfFlow = (position === 'fixed' || position === 'absolute') && box.top <= 1
      document.body.classList.toggle('has-fixed-header', outOfFlow)
    }

    syncHeaderOffset()
    window.addEventListener('resize', syncHeaderOffset)
    if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
      document.fonts.ready.then(syncHeaderOffset)
    }

    function closeNav() {
      if (!siteNav) return
      siteNav.classList.remove('is-open')
      if (navToggle) navToggle.setAttribute('aria-expanded', 'false')
    }

    function openNav() {
      if (!siteNav) return
      siteNav.classList.add('is-open')
      if (navToggle) navToggle.setAttribute('aria-expanded', 'true')
    }

    if (navToggle && siteNav) {
      navToggle.addEventListener('click', function () {
        if (siteNav.classList.contains('is-open')) closeNav()
        else openNav()
      })

      siteNav.addEventListener('click', function (event) {
        var link = event.target.closest('a')
        if (link) closeNav()
      })

      document.addEventListener('click', function (event) {
        if (!siteNav.classList.contains('is-open')) return
        if (siteNav.contains(event.target) || navToggle.contains(event.target)) return
        closeNav()
      })

      document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') closeNav()
      })
    }

    function currentPage() {
      var parts = window.location.pathname.split('/')
      var last = parts[parts.length - 1]
      return last === '' ? 'index.html' : last
    }

    var page = currentPage()
    var navLinks = document.querySelectorAll('.nav-link')
    Array.prototype.forEach.call(navLinks, function (link) {
      var href = link.getAttribute('href') || ''
      var target = href.split('#')[0]
      var hash = href.indexOf('#') > -1 ? href.slice(href.indexOf('#')) : ''
      var isSamePage = target === '' || target === page
      link.classList.remove('is-active')
      link.removeAttribute('aria-current')
      if (isSamePage && (!hash || hash === window.location.hash || hash === '#' + window.location.hash.slice(1))) {
        link.classList.add('is-active')
        link.setAttribute('aria-current', 'page')
      }
    })

    var smoothLinks = document.querySelectorAll('a[href^="#"]')
    Array.prototype.forEach.call(smoothLinks, function (link) {
      link.addEventListener('click', function (event) {
        var id = (link.getAttribute('href') || '').slice(1)
        if (!id) return
        var target = document.getElementById(id)
        if (!target) return
        event.preventDefault()
        closeNav()
        var offset = header ? header.offsetHeight + 8 : 0
        var top = target.getBoundingClientRect().top + window.pageYOffset - offset
        window.scrollTo({ top: top, behavior: reduceMotion ? 'auto' : 'smooth' })
        if (history.replaceState) history.replaceState(null, '', '#' + id)
      })
    })

    var revealItems = document.querySelectorAll('.reveal')
    if (revealItems.length > 0) {
      if (reduceMotion || !('IntersectionObserver' in window)) {
        Array.prototype.forEach.call(revealItems, function (item) {
          item.classList.add('in-view')
        })
      } else {
        var revealObserver = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              if (!entry.isIntersecting) return
              entry.target.classList.add('in-view')
              revealObserver.unobserve(entry.target)
            })
          },
          { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
        )
        Array.prototype.forEach.call(revealItems, function (item) {
          revealObserver.observe(item)
        })
      }
    }

    var faqCounter = 0

    function faqContainerOf(item) {
      var cursor = item.parentElement
      while (cursor && cursor !== document.body) {
        if (cursor.classList && cursor.classList.contains('faq')) return cursor
        cursor = cursor.parentElement
      }
      return item.parentElement
    }

    function syncFaqItem(item) {
      var toggle = item.querySelector('.faq-item__toggle')
      if (!toggle) return null
      var panel = item.querySelector('.faq-item__panel')
      if (panel) {
        var id = panel.getAttribute('id')
        if (!id || document.querySelectorAll('[id="' + id + '"]').length > 1) {
          faqCounter += 1
          id = 'faq-panel-' + faqCounter
          panel.setAttribute('id', id)
        }
        toggle.setAttribute('aria-controls', id)
        if (!toggle.getAttribute('aria-labelledby') && !toggle.getAttribute('aria-label')) {
          var question = item.querySelector('.faq-item__question')
          if (question && !question.getAttribute('id')) {
            question.setAttribute('id', id + '-label')
            toggle.setAttribute('aria-labelledby', id + '-label')
          }
        }
        var open = item.classList.contains('is-open')
        if (open) panel.removeAttribute('aria-hidden')
        else panel.setAttribute('aria-hidden', 'true')
      }
      toggle.setAttribute('aria-expanded', item.classList.contains('is-open') ? 'true' : 'false')
      return toggle
    }

    function syncFaq() {
      var items = document.querySelectorAll('.faq-item')
      Array.prototype.forEach.call(items, function (item) {
        syncFaqItem(item)
      })
    }

    function toggleFaq(item) {
      var container = faqContainerOf(item)
      var willOpen = !item.classList.contains('is-open')
      var items = container ? container.querySelectorAll('.faq-item') : [item]
      Array.prototype.forEach.call(items, function (other) {
        other.classList.remove('is-open')
        var otherToggle = other.querySelector('.faq-item__toggle')
        if (otherToggle) otherToggle.setAttribute('aria-expanded', 'false')
        var otherPanel = other.querySelector('.faq-item__panel')
        if (otherPanel) otherPanel.setAttribute('aria-hidden', 'true')
      })
      if (willOpen) {
        item.classList.add('is-open')
        var toggle = item.querySelector('.faq-item__toggle')
        if (toggle) toggle.setAttribute('aria-expanded', 'true')
        var panel = item.querySelector('.faq-item__panel')
        if (panel) panel.removeAttribute('aria-hidden')
      }
    }

    document.addEventListener('click', function (event) {
      var target = event.target
      if (!target || typeof target.closest !== 'function') return
      var toggle = target.closest('.faq-item__toggle')
      if (!toggle) return
      var item = toggle.closest('.faq-item')
      if (!item) return
      event.preventDefault()
      toggleFaq(item)
    })

    syncFaq()
    if (typeof MutationObserver === 'function') {
      var faqObserver = new MutationObserver(function (records) {
        records.forEach(function (record) {
          Array.prototype.forEach.call(record.addedNodes, function (node) {
            if (node.nodeType !== 1) return
            if (node.classList && node.classList.contains('faq-item')) {
              syncFaqItem(node)
            } else if (node.querySelector && node.querySelector('.faq-item')) {
              Array.prototype.forEach.call(node.querySelectorAll('.faq-item'), function (item) {
                syncFaqItem(item)
              })
            }
          })
        })
      })
      faqObserver.observe(document.body, { childList: true, subtree: true })
    }

    if (backToTop) {
      backToTop.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
      })
      var toggleBackToTop = function () {
        if (window.pageYOffset > 480) backToTop.classList.add('is-visible')
        else backToTop.classList.remove('is-visible')
      }
      toggleBackToTop()
      window.addEventListener('scroll', toggleBackToTop, { passive: true })
    }

    if (header) {
      var toggleHeader = function () {
        if (window.pageYOffset > 12) header.classList.add('is-scrolled')
        else header.classList.remove('is-scrolled')
      }
      toggleHeader()
      window.addEventListener('scroll', toggleHeader, { passive: true })
    }

    var yearTargets = document.querySelectorAll('[data-year]')
    Array.prototype.forEach.call(yearTargets, function (node) {
      node.textContent = String(new Date().getFullYear())
    })

    var forms = document.querySelectorAll('form[data-validate]')
    Array.prototype.forEach.call(forms, function (form) {
      var success = form.querySelector('.form-success')
      var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

      function fieldError(input, message) {
        var field = input.closest('.form-field')
        var errorNode = null
        if (field) errorNode = field.querySelector('.form-error')
        else if (input.id) errorNode = document.querySelector('[data-error-for="' + input.id + '"]')
        if (field) {
          field.classList.toggle('is-invalid', Boolean(message))
          field.classList.toggle('is-valid', !message && input.value.trim() !== '')
        }
        if (errorNode) errorNode.textContent = message || ''
        input.setAttribute('aria-invalid', message ? 'true' : 'false')
        return !message
      }

      function validateInput(input) {
        var value = input.value.trim()
        if (input.hasAttribute('required') && !value) {
          return fieldError(input, input.dataset.label ? input.dataset.label + ' is required.' : 'This field is required.')
        }
        if (input.type === 'email' && value && !emailPattern.test(value)) {
          return fieldError(input, 'Enter a valid email address, such as name@company.com.')
        }
        if (input.tagName === 'TEXTAREA' && value && value.length < 10) {
          return fieldError(input, 'Please add a little more detail (at least 10 characters).')
        }
        return fieldError(input, '')
      }

      var inputs = form.querySelectorAll('.form-input, .form-textarea')
      Array.prototype.forEach.call(inputs, function (input) {
        input.addEventListener('blur', function () {
          validateInput(input)
        })
        input.addEventListener('input', function () {
          var field = input.closest('.form-field')
          if (field && field.classList.contains('is-invalid')) validateInput(input)
        })
      })

      form.addEventListener('submit', function (event) {
        event.preventDefault()
        var valid = true
        Array.prototype.forEach.call(inputs, function (input) {
          if (!validateInput(input)) valid = false
        })
        if (!valid) {
          var firstInvalid = form.querySelector('.is-invalid .form-input, .is-invalid .form-textarea')
          if (firstInvalid) firstInvalid.focus()
          return
        }
        if (success) {
          success.classList.add('is-visible')
          success.setAttribute('role', 'status')
        }
        form.reset()
        Array.prototype.forEach.call(inputs, function (input) {
          var field = input.closest('.form-field')
          if (field) field.classList.remove('is-valid')
        })
      })
    })
  })
})()
