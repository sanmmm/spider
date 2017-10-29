let request = require('request');
let cheerio = require('cheerio');
let through2 = require('through2');
let Buffer = require('buffer').Buffer;
const http = require('http');
const fs = require('fs');

let dataStream = null;

function main () {
	let pageList = [],
		httpServer,
		stack = [];
	for (let i = 0; i < 200; i ++ ) { // 初始化爬虫的入口列表
		pageList.push('https://www.cnblogs.com/sitehome/p/' + i);
	}
	dataStream = through2.obj( // 创建一个读写流对象
		function (chunk, enc, cb) {
			cb(null, chunk);
		},
		function (cb) {
			cb();
		}
	);
	pageList.forEach(item => { // 将爬取目标推入请求栈中
		stack.push(async function () {
			try {
				let buffer = await getPromise(item);
				return buffer;
			} catch (e) {
				console.log('get page list error', e.message);
			}
		});
	});
	httpServer = createServer(dataStream); // 创建http服务
	startSpider(stack);
}

function createServer (dataStream) {
	let server = http.createServer(function (req, res) {
		res.setHeader('Content-Type', 'text/plain; charset=utf-8');
		dataStream.pipe(res);
	}).listen(8000);
	return server;
}

async function startSpider (stack) {
	let stack2 = [];
	let num = 0;
	await startStack(stack, 5, function (data) {
		let $ = cheerio.load(data);
		let links = $('#post_list .titlelnk').map(function (i, el) {
			return $(el).attr('href');
		}).get();
		links = links.map(function (item) {
			dataStream.write(`第${++num}个链接：${item}\n`);
			return getPromise(item);
		});
		stack2 = stack2.concat(links);
		// console.log(links, num);
	});
	num = 0;
	await startStack(stack2, 5, function (data) {
		let dataObj = extractPageInfo(data);
		console.log(dataObj);
		dataStream.write(`第${++num}篇文章的信息：` + JSON.stringify(dataObj) + '\n');
	});
	dataStream.end('爬取完毕');
}

async function startStack (stack, max = 1, func) { // max为并发最大数,默认值为1, func为得到数据后的处理函数
	try {
		while (stack.length) {
			console.log('stack length', stack.length);
			let arr = stack.splice(0, max);
			let responses = arr.map(function (item) { // 基本类型 promise对象 和 返回值为promise对象的函数
				if (item instanceof Function) 
					return item();
				return item;
			});
			for (let item of responses) {
				let data = await item;
				func && func(data);
			}
		}
	} catch (e) {
		console.log('stack error:', e.message);
	}
}

function extractPageInfo (data) {
	let $ = cheerio.load(data);
	return {
		title: $('#cb_post_title_url').text(),
		author: $('#topics > div > div.postDesc > a:nth-child(2)').text(),
		time: $('#post-date').text()
	};
}

function getPromise (url) { // 取得request的promise处理
	let buffer = [];
	return new Promise(function (resolve, reject) {
		request(url)
			.pipe(through2(
				function (chunk, enc, cb) {
					buffer.push(chunk);
					cb();
				}, function (cb) {
					resolve(Buffer.concat(buffer).toString());
					cb();
				}
			));
	});
}

main();
// request('http://www.cnblogs.com/lxp503238/p/7151842.html')
// 	.pipe(through2(
// 		function (chunk, enc, cb) {
// 			buffer.push(chunk);
// 			cb();
// 		}, function (cb) {
// 			$ = cheerio.load(Buffer.concat(buffer).toString());
// 			extract();
// 			cb();
// 		}
// 	));

