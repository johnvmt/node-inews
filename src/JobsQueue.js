import EventEmitter from 'wolfy87-eventemitter';
import Promise from 'bluebird';

class JobsQueue extends EventEmitter {

	constructor() {
		super();

		const self = this;

		Promise.config({
			cancellation: true
		});

		self.queued = new Set();
		self.running = new Set();

		self.on('start', startQueue);
		self.on('end', startQueue);
		self.on('enqueue', startQueue);
		self.on('cancel', startQueue);

		function startQueue() {
			self.emit('queued', this.queued.size);
			self.emit('running', this.running.size);
			self.startNext();
		}
	}

	async startNext() {
		if(this.queued.size > 0) {
			let job = this.queued.entries().next().value[0];

			if(typeof job.config.startFilter !== 'function' || job.config.startFilter()) {
				this.queued.delete(job);
				this.running.add(job);

				try {
					this.emit('start', job);
					job.resolve(await this.attemptJobWithRetries(job));
				}
				catch(error) {
					job.reject(error);
				}
				finally {
					this.running.delete(job);
					this.emit('end', job);
				}
			}
		}
	}

	async attemptJobWithRetries(job) {
		try {
			return await this.attemptJobOnce(job);
		}
		catch(error) {
			if(typeof job.config.retryFilter === 'function' && job.config.retryFilter(error))
				return this.attemptJobWithRetries(job);
			else
				throw error;
		}
	}

	async attemptJobOnce(job) {
		return new Promise(async (resolve, reject) => {
			let jobTimeout = (typeof job.config.timeout === 'number' && job.config.timeout > 0) ? setTimeout(() => {
				reject('timeout');
			}, job.config.timeout) : null;

			try {
				resolve(await job.config.start());
			}
			catch(error) {
				reject(error);
			}
			finally {
				if(jobTimeout !== null)
					clearTimeout(jobTimeout);
			}
		});
	}

	enqueue(jobConfig) {
		// return a cancelable promise
		const self = this;

		return new Promise((resolve, reject, onCancel) => {
			let job = {
				config: jobConfig,
				resolve: resolve,
				reject: reject
			};

			self.queued.add(job);
			self.emit('enqueue', job);

			onCancel(() => {
				if(self.queued.has(job)) {
					self.queued.delete(job);
					self.emit('cancel', job);
				}
			});
		});
	}
}

export default JobsQueue;
