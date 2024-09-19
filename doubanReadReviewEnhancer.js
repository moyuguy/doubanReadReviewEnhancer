// ==UserScript==
// @name         豆瓣书籍评分增强
// @namespace    https://okjk.co/VJQF62
// @version      0.3
// @description  在豆瓣读书页面添加Goodreads和Amazon的评分，样式与豆瓣原生评分一致
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

    let ISBN, bookTitle, originalTitle;

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

            if (!ISBN || !bookTitle) {
                throw new Error('无法从元素中提取ISBN或书名');
            }

             // 添加加载提示
            const loadingSpan = document.createElement('span');
            loadingSpan.id = 'custom_rating_loading';
            loadingSpan.className = 'custom_rating';
            loadingSpan.textContent = '第三方评分加载中...';
            const targetElement = document.querySelector('#interest_sectl');
            if (targetElement) {
                targetElement.appendChild(loadingSpan);
            }

            fetchGoodreadsRating();
            fetchAmazonRating();
            fetchWereadRating();
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

    function fetchGoodreadsRating() {
    console.log('正在获取Goodreads评分...');
    pendingRequests++;

    function performSearch(term, searchType) {
        console.log(`使用${searchType}搜索Goodreads: ${term}`);
        GM_xmlhttpRequest({
            method: "GET",
            url: `https://www.goodreads.com/search?q=${encodeURIComponent(term)}`,
            onload: function(response) {
                try {
                    if (response.finalUrl.includes('/book/show/')) {
                        parseGoodreadsPage(response.responseText, response.finalUrl);
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
                                }
                            });
                        } else {
                            if (searchType === 'ISBN' && originalTitle) {
                                console.log('ISBN搜索未找到结果，尝试使用原作名搜索...');
                                performSearch(originalTitle, '原作名');
                            } else if (searchType === '原作名' && bookTitle) {
                                console.log('原作名搜索未找到结果，尝试使用书名搜索...');
                                performSearch(bookTitle, '书名');
                            } else {
                                throw new Error('在Goodreads搜索结果中未找到匹配的书籍');
                            }
                        }
                    }
                } catch (error) {
                    console.error('处理Goodreads评分时出错:', error);
                    updateLoadingStatus();
                }
            },
            onerror: function(error) {
                console.error('获取Goodreads评分失败:', error);
                updateLoadingStatus();
            }
        });
    }

    // 首先尝试使用ISBN搜索
    if (ISBN) {
        performSearch(ISBN, 'ISBN');
    } else if (originalTitle) {
        performSearch(originalTitle, '原作名');
    } else if (bookTitle) {
        performSearch(bookTitle, '书名');
    } else {
        console.error('没有可用的搜索条件');
        updateLoadingStatus();
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
        console.log(`Goodreads评分: ${rating}, 评价人数: ${count}`);
        addRating('Goodreads', rating, count, url);
    }

    function fetchAmazonRating() {
        console.log('正在获取Amazon评分...');
        const searchQuery = originalTitle || bookTitle;

        GM_xmlhttpRequest({
            method: "GET",
            url: `https://www.amazon.com/s?k=${encodeURIComponent(searchQuery)}`,
            onload: function(response) {
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(response.responseText, "text/html");

                    // 查找第一个搜索结果的链接
                    const firstResultLink = doc.querySelector('.s-result-item .a-link-normal.s-underline-text');

                    if (!firstResultLink) {
                        throw new Error('无法在Amazon搜索结果中找到匹配的书籍');
                    }

                    const bookLink = 'https://www.amazon.com' + firstResultLink.getAttribute('href');
                    fetchAmazonRatingFromLink(bookLink);
                } catch (error) {
                    console.error('处理Amazon搜索结果时出错:', error);
                }
            },
            onerror: function(error) {
                console.error('获取Amazon评分失败:', error);
            }
        });
    }

    function fetchWereadRating() {
        pendingRequests++;
        console.log('正在获取微信读书评分...');
        const searchQuery = encodeURIComponent(bookTitle);
        const url = `https://weread.qq.com/web/search/global?keyword=${searchQuery}`;
    
        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            onload: function(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    const books = data.books;
    
                    if (books && books.length > 0) {
                        const matchedBook = findMatchingBook(books, bookTitle);
                        if (matchedBook) {
                            const book = matchedBook.bookInfo;
                            const ratingPercentage = book.newRating ? (book.newRating / 10).toFixed(1) + '%' : 'N/A';
                            const ratingCount = book.newRatingCount || 0;
    
                            console.log(`微信读书评分: ${ratingPercentage}, 评价人数: ${ratingCount}`);
                            addRating('微信读书', ratingPercentage, ratingCount, `https://weread.qq.com/web/search/books?keyword=${searchQuery}`, true);
                        } else {
                            throw new Error('未找到完全匹配的书籍');
                        }
                    } else {
                        throw new Error('未找到任何匹配的书籍');
                    }
                } catch (error) {
                    console.error('处理微信读书评分时出错:', error);
                } finally {
                    updateLoadingStatus();
                }
            },
            onerror: function(error) {
                console.error('获取微信读书评分失败:', error);
                updateLoadingStatus();
            }
        });
    }

    function findMatchingBook(books, targetTitle) {
    // 清理标题，移除所有标点符号和空格，转换为小写
    const cleanTitle = (title) => title.toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, "");
    const cleanTargetTitle = cleanTitle(targetTitle);

    // 首先尝试完全匹配
    let matchedBook = books.find(book => cleanTitle(book.bookInfo.title) === cleanTargetTitle);

    // 如果没有完全匹配，尝试部分匹配
    if (!matchedBook) {
        matchedBook = books.find(book => cleanTitle(book.bookInfo.title).includes(cleanTargetTitle) || 
                                         cleanTargetTitle.includes(cleanTitle(book.bookInfo.title)));
    }

    return matchedBook;
}

    function fetchAmazonRatingFromLink(link) {
        GM_xmlhttpRequest({
            method: "GET",
            url: link,
            onload: function(response) {
                try {
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(response.responseText, "text/html");

                    // 查找评分元素
                    const ratingElement = doc.querySelector('#acrPopover');
                    const reviewCountElement = doc.querySelector('#acrCustomerReviewText');

                    if (!ratingElement || !reviewCountElement) {
                        throw new Error('无法在Amazon页面找到评分元素');
                    }

                    const rating = ratingElement.getAttribute('title').split(' ')[0];
                    const reviewCount = reviewCountElement.textContent.trim().split(' ')[0].replace(/,/g, '');

                    console.log(`Amazon评分: ${rating}, 评价人数: ${reviewCount}`);
                    addRating('Amazon', rating, reviewCount, link);
                } catch (error) {
                    console.error('处理Amazon评分时出错:', error);
                }
            },
            onerror: function(error) {
                console.error('获取Amazon评分失败:', error);
            }
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
        }finally {
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

    // 监听页面加载完成事件
    window.addEventListener('load', init);

    // 立即添加样式
    addStyles();
})();