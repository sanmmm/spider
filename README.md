# Node.js 爬虫

js作为脚本语言，它的灵活性和开发效率都可以保证。借助于node.js,使用js写爬虫也变得更加自由（摆脱了宿主浏览器）和简单。

此爬虫爬取对象为博客园，是一个很小的练手项目，目标为： 获得博客园首页200个分页的热门文章列表，并将每篇文章爬取下来。最后我们可以通过浏览器来得到爬去到的信息。

在爬取和处理数据的过程用，用到的第三方库有request、through2、cherrio。使用request来进行http请求。使用cherrio来对请求得到的数据进行解析。使用through2来更好操作stream对象。

首先，有三个要注意的：
1.  因为http请求是异步的，因此如果一个一个url请求速度太慢，而如果并发的请求太多可能会被网站判定为dos攻击，因此要限制并发数，这里假定为5。
2. 要注意保证爬取到信息的有序性
3. 我们还需要建立一个http服务，返回爬取到的信息。

因为是定向爬虫，思路很简单，第一阶段，爬去目标为热门文章的url,先从入口网址[博客园](https://www.cnblogs.com/)开始，根据固定的格式构造200个分页的url，然后先以每个url为请求目标进行请求，然后将每个分页得到的20个热门文章url进行顺序存储，待所有url请求完毕之后，开始进行第二阶段，即文章内容的爬取。随后，对爬取到的文章进行处理，提取有效信息，等待用户进行http请求的时候返回。

然后，具体实现为：

### 第一版本
在第一阶段，先进行初始化的工作，如构造url, 建立http服务等。

将请求用promise进行包装的功能函数
``` javascript
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
```

构造url：
``` javascript
	for (let i = 0; i < 200; i ++ ) { // 初始化爬虫的入口列表
		pageList.push('https://www.cnblogs.com/sitehome/p/' + i);
	}
```
使用through2来创建一个duplex(双工) stream对象，用来写入和输出通过爬取得到的文章信息，以供http服务使用：
``` javascript
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
```
创建http服务：

``` javascript
function createServer (dataStream) {
	let server = http.createServer(function (req, res) {
		res.setHeader('Content-Type', 'text/plain; charset=utf-8');
		dataStream.pipe(res);
	}).listen(8000);
	return server;
}
```
至此第一阶段准备工作完成，开始爬取。
``` javascript
startSpider(stack);
```
接下来为爬取的过程。startStack函数为控制并发数的函数，它利用了js async函数的特性来控制异步。函数stack参数用来传入一个队列，这个队列的每个元素都是一个可执行的函数，且返回值为基本类型或者promise对象，max为并发数，默认为1，func为请求结束得到数据的处理函数。
``` javascript
async function startStack (stack, func, max = 1) { // max为并发最大数,默认值为1, func为得到数据后的处理函数
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
```
startSpider为爬虫的非功能函数部分，在第一次调用startStack函数中传入的func参数目标是在得到爬取到的数据后从中提取出文章的具体url，而第二次则是从得到的文章页面数据中提取中我们想要的文章数据。提取过程中我们使用了cherrio库来解析html。
``` javascript
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
	});
	num = 0;
	await startStack(stack2, 5, function (data) {
		let dataObj = extractPageInfo(data);
		console.log(dataObj);
		dataStream.write(`第${++num}篇文章的信息：` + JSON.stringify(dataObj) + '\n');
	});
	dataStream.end('爬取完毕');
}
```
最后，得到的数据存入上面我们建立的stream对象中，等待http服务返回.
```	 javascript
dataStream.write(`第${++num}篇文章的信息：` + JSON.stringify(dataObj) + '\n');
```

完整代码见：[第一版本](./spider1/index.js)。

### 第二版本
然后，我们可以使用stream对象来改进一下代码。

我们可以定义个reqStack类，用来创建一个功能比较完备的请求队列对象。这个对象继承自stream类对象的Transform对象，如下：
``` javascript
class reqStack extends Transform {
	constructor (concurr) {
		super({
			transform:  (chunk, enc, cb) => {
				this.flag = true;
				(async function () {
					try {
						while (this.flag && this.stack.length) {
							console.log('stack length', this.stack.length);
							let arr = this.stack.splice(0, this.concurr);
							let responses = arr.map(function (item) { // 基本类型 promise对象 和 返回值为promise对象的函数
								if (item instanceof Function) 
									return item();
								return item;
							});
							for (let item of responses) {
								let data = await item;
								this.emit('data', data); //触发data事件
							}
						}
						if (this.isEmpty() && this.isClose) {
							this.end();
						}
					} catch (e) {
						console.log('stack error:', e);
					}
				})();
			},
			flush: () => {
				
			}
		});
		this.concurr = concurr;
	}
}
```
它的功能有进行并发请求，并可以设置并发数：
同时利用事件机制来进行触发，如在得到返回数据后发射data信号。

完整代码见[stream版本](./spider1/stream.js)

### 第三版本
因为stream是继承自事件对象，因此我们可以通过EventEmitter类来直接创建一个请求列表对象。
``` javascript
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
```
该对象在具有请求并发控制的基础上，借助于EventEmitter的信号机制，添加了开始，暂停，关闭功能。

完整代码见[第三个版本](./spider/index4.js)