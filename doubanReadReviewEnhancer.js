// ==UserScript==
// @name         豆瓣书籍评分增强
// @namespace    https://okjk.co/VJQF62
// @version      0.4
// @description  在豆瓣读书页面添加Goodreads、Amazon和微信读书的评分
// @match        https://book.douban.com/subject/*
// @icon         https://img3.doubanio.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @author       moyuguy
// @homepage     https://github.com/moyuguy
// @license      MIT
// ==/UserScript==

(function() {
    'use strict';

    let ISBN, bookTitle, originalTitle, author;
    let pendingRequests = 0;
    let allRequestsFailed = true;

    function init() {
        try {
            const infoElement = document.querySelector('#info');
            const titleElement = document.querySelector('h1');

            if (!infoElement || !titleElement) {
                throw new Error('无法找到包含信息的元素');
            }

            const isbnMatch = infoElement.textContent.match(/ISBN:\s*(\d+)/);
            ISBN = isbnMatch ? isbnMatch[1] : null;

            bookTitle = titleElement.textContent.trim();

            const originalTitleMatch = infoElement.textContent.match(/原作名:\s*(.+)/);
            originalTitle = originalTitleMatch ? originalTitleMatch[1].trim() : null;

            // 提取作者信息
            const authorSpan = Array.from(infoElement.querySelectorAll('span.pl')).find(span => 
                span.textContent.trim().includes('作者')
            );
            if (authorSpan) {
                const authorLink = authorSpan.nextElementSibling;
                if (authorLink && authorLink.tagName === 'A') {
                    author = authorLink.textContent.trim();
                } else {
                    const authorText = authorSpan.nextSibling ? authorSpan.nextSibling.textContent.trim() : '';
                    author = authorText ? authorText : null;
                }
            } else {
                throw new Error('无法找到作者信息');
            }

            // 检查所有必要信息是否都已提取
            const missingInfo = [];
            if (!ISBN) missingInfo.push('ISBN');
            if (!bookTitle) missingInfo.push('书名');
            if (!author) missingInfo.push('作者');

            if (missingInfo.length > 0) {
                throw new Error(`无法从元素中提取以下信息：${missingInfo.join('、')}`);
            }

            console.log('提取的图书信息:', { ISBN, bookTitle, originalTitle, author });

            const loadingSpan = document.createElement('span');
            loadingSpan.id = 'custom_rating_loading';
            loadingSpan.className = 'custom_rating';
            loadingSpan.textContent = '第三方评分加载中...';
            const targetElement = document.querySelector('#interest_sectl');
            if (targetElement) {
                targetElement.appendChild(loadingSpan);
            }

            fetchRating('Goodreads');
            fetchRating('Amazon');
            fetchRating('WeRead');
        } catch (error) {
            console.error('初始化错误:', error);
        }
    }

    function updateLoadingStatus() {
        pendingRequests--;
        if (pendingRequests === 0) {
            const loadingSpan = document.getElementById('custom_rating_loading');
            if (loadingSpan) {
                if (allRequestsFailed) {
                    loadingSpan.textContent = '暂未查到第三方评分';
                } else {
                    loadingSpan.remove();
                }
            }
        }
    }

    function fetchRating(platform) {
        console.log(`正在获取${platform}评分...`);
        pendingRequests++;

        let searchOrder;
        switch (platform) {
            case 'WeRead':
                searchOrder = [{ type: '书名', term: bookTitle }];
                break;
            case 'Goodreads':
                searchOrder = [
                    { type: 'ISBN', term: ISBN },
                    { type: '原作名', term: originalTitle },
                    { type: '书名', term: bookTitle }
                ];
                break;
            case 'Amazon':
                searchOrder = [
                    { type: 'ISBN', term: ISBN },
                    { type: '原作名', term: originalTitle },
                    { type: '书名作者', term: `${bookTitle} ${author}` }
                ];
                break;
        }

        function tryNextSearch(index) {
            if (index >= searchOrder.length) {
                console.error(`在${platform}上未找到匹配的书籍`);
                updateLoadingStatus();
                return;
            }

            const { type, term } = searchOrder[index];
            if (!term) {
                tryNextSearch(index + 1);
                return;
            }

            console.log(`在${platform}上使用${type}搜索: ${term}`);
            performSearch(platform, term, type, (success) => {
                if (!success) tryNextSearch(index + 1);
            });
        }

        tryNextSearch(0);
    }

    function performSearch(platform, term, searchType, callback) {
        const urls = {
            Goodreads: `https://www.goodreads.com/search?q=${encodeURIComponent(term)}`,
            Amazon: `https://www.amazon.com/s?k=${encodeURIComponent(term)}`,
            WeRead: `https://weread.qq.com/web/search/global?keyword=${encodeURIComponent(term)}`
        };

        GM_xmlhttpRequest({
            method: "GET",
            url: urls[platform],
            onload: function(response) {
                try {
                    switch(platform) {
                        case 'Goodreads':
                            handleGoodreadsSearch(response, callback);
                            break;
                        case 'Amazon':
                            handleAmazonSearch(response, callback, searchType);
                            break;
                        case 'WeRead':
                            handleWeReadSearch(response, callback);
                            break;
                    }
                } catch (error) {
                    console.error(`处理${platform}搜索结果时出错:`, error);
                    callback(false);
                }
            },
            onerror: function(error) {
                console.error(`获取${platform}评分失败:`, error);
                callback(false);
            }
        });
    }

    function handleGoodreadsSearch(response, callback) {
        if (response.finalUrl.includes('/book/show/')) {
            parseGoodreadsPage(response.responseText, response.finalUrl);
            callback(true);
        } else {
            const parser = new DOMParser();
            const doc = parser.parseFromString(response.responseText, "text/html");
            const bookLink = doc.querySelector('a.bookTitle');
            if (bookLink) {
                const bookUrl = 'https://www.goodreads.com' + bookLink.getAttribute('href');
                GM_xmlhttpRequest({
                    method: "GET",
                    url: bookUrl,
                    onload: function(bookResponse) {
                        parseGoodreadsPage(bookResponse.responseText, bookUrl);
                        callback(true);
                    }
                });
            } else {
                callback(false);
            }
        }
    }

    function handleAmazonSearch(response, callback, searchType) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(response.responseText, "text/html");

        const noResultsElement = doc.querySelector('.s-no-outline');
        if (noResultsElement && noResultsElement.textContent.includes('No results for')) {
            console.log('Amazon搜索无结果');
            callback(false);
            return;
        }

        const results = doc.querySelectorAll('.s-result-item');
        for (let result of results) {
            const titleElement = result.querySelector('h2 .a-link-normal');
            const authorElement = result.querySelector('.a-size-base.a-link-normal');
            if (titleElement && (searchType === 'ISBN' || authorElement)) {
                const resultTitle = titleElement.textContent.trim();
                const resultAuthor = authorElement ? authorElement.textContent.trim() : '';
                if (isMatchingBook(resultTitle, resultAuthor, searchType)) {
                    const bookLink = 'https://www.amazon.com' + titleElement.getAttribute('href');
                    fetchAmazonRatingFromLink(bookLink);
                    callback(true);
                    return;
                }
            }
        }
        console.log('Amazon搜索未找到匹配结果');
        callback(false);
    }

    function handleWeReadSearch(response, callback) {
        const data = JSON.parse(response.responseText);
        const books = data.books;
        if (books && books.length > 0) {
            const matchedBook = findMatchingBook(books);
            if (matchedBook) {
                const book = matchedBook.bookInfo;
                const ratingPercentage = book.newRating ? (book.newRating / 10).toFixed(1) + '%' : 'N/A';
                const ratingCount = book.newRatingCount || 0;
                addRating('微信读书', ratingPercentage, ratingCount, `https://weread.qq.com/web/search/books?keyword=${encodeURIComponent(bookTitle)}`, true);
                callback(true);
            } else {
                callback(false);
            }
        } else {
            callback(false);
        }
    }

    function isMatchingBook(resultTitle, resultAuthor, searchType) {
        const cleanStr = (s) => s.toLowerCase().replace(/[^\w\s]/g, '');
        const cleanResultTitle = cleanStr(resultTitle);
        const cleanResultAuthor = cleanStr(resultAuthor);
        
        switch (searchType) {
            case 'ISBN':
                return cleanResultTitle.includes(cleanStr(ISBN));
            case '原作名':
                return cleanResultTitle.includes(cleanStr(originalTitle));
            case '书名作者':
                return cleanResultTitle.includes(cleanStr(bookTitle)) && cleanResultAuthor.includes(cleanStr(author));
            default:
                return false;
        }
    }

    function parseGoodreadsPage(html, url) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const ratingElement = doc.querySelector('.RatingStatistics__rating');
        const countElement = doc.querySelector('[data-testid="ratingsCount"]');

        if (!ratingElement || !countElement) {
            throw new Error('无法在Goodreads页面找到评分元素');
        }

        const rating = ratingElement.textContent.trim();
        const count = countElement.textContent.trim().replace(/,/g, '').replace(/\s+ratings$/, '');
        addRating('Goodreads', rating, count, url);
    }

    function fetchAmazonRatingFromLink(link) {
        GM_xmlhttpRequest({
            method: "GET",
            url: link,
            onload: function(response) {
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(response.responseText, "text/html");
                    const ratingElement = doc.querySelector('#acrPopover');
                    const reviewCountElement = doc.querySelector('#acrCustomerReviewText');

                    if (!ratingElement || !reviewCountElement) {
                        throw new Error('无法在Amazon页面找到评分元素');
                    }

                    const rating = ratingElement.getAttribute('title').split(' ')[0];
                    const reviewCount = reviewCountElement.textContent.trim().split(' ')[0].replace(/,/g, '');

                    addRating('Amazon', rating, reviewCount, link);
                } catch (error) {
                    console.error('处理Amazon评分时出错:', error);
                    updateLoadingStatus();
                }
            },
            onerror: function(error) {
                console.error('获取Amazon评分失败:', error);
                updateLoadingStatus();
            }
        });
    }

    function findMatchingBook(books) {
        const cleanTitle = (title) => title.toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, "");
        const cleanBookTitle = cleanTitle(bookTitle);
        const cleanOriginalTitle = originalTitle ? cleanTitle(originalTitle) : null;

        return books.find(book => {
            const cleanBookInfoTitle = cleanTitle(book.bookInfo.title);
            return cleanBookInfoTitle === cleanBookTitle ||
                (cleanOriginalTitle && cleanBookInfoTitle === cleanOriginalTitle);
        });
    }

    function addRating(site, rating, ratingCount, url, isPercentage = false) {
        try {
            allRequestsFailed = false;
            const ratingSpan = document.createElement('span');
            ratingSpan.className = 'custom_rating';
            const tooltipText = isPercentage ? `推荐值 ${rating} ${ratingCount}人评价` : `${rating}/5.0 ${ratingCount}人评价`;
            ratingSpan.innerHTML = `
                <span class="rating_wrapper">
                    <a href="${url}" target="_blank" class="site_name" data-tooltip="${tooltipText}">${site}</a>
                    <span class="custom_rating_num" data-tooltip="${tooltipText}">${rating}</span>
                </span>
            `;

            const targetElement = document.querySelector('#interest_sectl');
            if (!targetElement) {
                throw new Error('无法找到目标元素来插入评分');
            }
            targetElement.appendChild(ratingSpan);
        } catch (error) {
            console.error(`添加 ${site} 评分时出错:`, error);
        } finally {
            updateLoadingStatus();
        }
    }

    function addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .custom_rating {
                display: block;
                margin-bottom: 5px;
                font-size: 12px;
            }
            .rating_wrapper {
                display: flex;
                justify-content: space-between;
                align-items: center;
                width: 100%;
            }
            .custom_rating .site_name {
                color: #37a;
                text-decoration: none;
                transition: color 0.3s ease, background-color 0.3s ease;
                border-radius: 3px;
            }
            .custom_rating .site_name:hover {
                color: #fff;
                background-color: #37a;
            }
            .custom_rating .custom_rating_num {
                color: #333;
                font-weight: bold;
            }
            [data-tooltip] {
                position: relative;
            }
            [data-tooltip]:hover::after {
                content: attr(data-tooltip);
                position: absolute;
                bottom: 100%;
                left: 50%;
                transform: translateX(-50%);
                background-color: #333;
                color: #fff;
                padding: 5px 10px;
                border-radius: 4px;
                font-size: 14px;
                white-space: nowrap;
                z-index: 1000;
                margin-bottom: 5px;
            }
        `;
        document.head.appendChild(style);
    }

    window.addEventListener('load', init);
    addStyles();
})();