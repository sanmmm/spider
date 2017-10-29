// 改进性能问题，解决stream缓存区爆掉的风险
let request = require('request');
let cheerio = require('cheerio');
let through2 = require('through2');
// let Buffer = require('buffer').Buffer;
const http = require('http');
const fs = require('fs');
const EventEmitter = require('events');
let dataStream = null;
let buffer = []; // 缓存要通过ｈｔｔｐ返回的数据

class reqStack extends EventEmitter {
	constructor (reqs = [], concurr = 1) { // 参数为并发数,可以注册的事件有'data' 'end'
		super();
		this.concurr = concurr;
		this.stack = reqs;
		this.flag = false; // 是否开启的标识变量
		this.isClose = false;
	}
	push (...args) {
		console.log('data input');
		if (this.isClose) {
			return false;
		}
		let isEmpty = this.isEmpty();
		this.stack.push(...args);
		this.flag && isEmpty && this.start();
		return true;
	}
	async start () {
		this.flag = true;
		console.log('start', this.stack.length);
		try {
			while (this.flag && this.stack.length) {
				console.log('stack length', this.stack.length);
				let arr = this.stack.splice(0, this.concurr);
				let responses = arr.map(function (item) { // 基本类型 promise对象 和 返回值为promise对象的函数
					if (item instanceof Function) {
						return item();
					}
					return item;
				});
				for (let item of responses) {
					let data = await item;
					this.emit('data', data); // 触发data事件
				}
			}
			if (this.isEmpty() && this.isClose) {
				this.end();
			}
		} catch (e) {
			console.log('stack error:', e);
		}
	}
	end () {
		console.log('stack end');
		this.emit('end');
	}
	pause () {
		process.nextTick(_ => {
			this.flag = false;
		});
	}
	isEmpty () {
		return this.stack.length === 0;
	}
	close () {
		this.isClose = true;
	}
}

function main () {
	let pageList = [],
		httpServer,
		stack = [];
	for (let i = 0; i < 1; i ++ ) { // 初始化爬虫的入口列表
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
	let urlstack = [],
		stack2 = [],
		num = 0,
		num2 = 0;
	urlstack = new reqStack(stack, 5);
	urlstack.on('data', function (data) {
		let $ = cheerio.load(data);
		let links = $('#post_list .titlelnk').map(function (i, el) {
			return $(el).attr('href');
		}).get();
		links = links.map(function (item) {
			writeStreamData(`第${++num}个链接：${item}\n`, dataStream);
			// dataStream.write(`第${++num}个链接：${item}\n`);
			return getPromise(item);
		});
		stack2.push(...links);
	});
	urlstack.on('end', function () {
		stack2.close();
	})
	urlstack.close();
	urlstack.start();
	stack2 = new reqStack([], 5);
	stack2.on('data', function (data) {
		let dataObj = extractPageInfo(data);
		console.log(dataObj);
		writeStreamData(`第${++num2}篇文章的信息：` + JSON.stringify(dataObj) + '\n', dataStream);
	});
	stack2.on('end', function () {
		dataStream.end('爬取完毕');
	})
	stack2.start();
	// stack2.pause();
	// setTimeout(function () {
	// 	stack2.start();
	// }, 1000);
	// dataStream.end('爬取完毕');
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

function writeStreamData (data, stream) {
	if (!stream.write(data)) {
		buffer.push(data);
		stream.once('drain', function () {
			for (let x of buffer)
				writeStreamData(x, stream);
		});
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
