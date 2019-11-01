import EventEmitter from "wolfy87-eventemitter";
import Promise from "bluebird";

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

		let queued = 0;
		let running = 0;
		let requests = 0;
		function startQueue() {
			if(self.queued.size !== queued) {
				queued = self.queued.size;
				self.emit('queued', queued);
			}

			if(self.running.size !== running) {
				running = self.running.size;
				self.emit('running', running);
			}

			if(self.running.size + self.queued.size !== requests) {
				requests = self.running.size + self.queued.size;
				self.emit('requests', requests);
			}

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
					job.attempts = this.attemptJobWithRetries(job);
					job.resolve(await job.attempts);
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

	attemptJobWithRetries(job) {
		const self = this;

		return self.attemptJobOnce(job).catch((error) => {
			if(typeof job.config.retryFilter === 'function' && job.config.retryFilter(error))
				return this.attemptJobWithRetries(job);
			else
				throw error;
		});
	}

	attemptJobOnce(job) {
		const self = this;
		return new Promise(async (resolve, reject, onCancel) => {
			try {
				let startResult = job.config.start();
				if(startResult instanceof Promise) {
					const jobTimeout = (typeof job.config.timeout === 'number' && job.config.timeout > 0) ? setTimeout(() => {
						reject(new Error('timeout'));
					}, job.config.timeout) : null;

					onCancel(() => {
						if(typeof startResult.cancel === 'function') {
							try {
								startResult.cancel();
							}
							catch(error) {
								self.emit('error', error);
							}
						}
					});

					startResult.then(resolve).catch(reject).finally(() => {
						if(jobTimeout !== null)
							clearTimeout(jobTimeout);
					});
				}
				else
					resolve(startResult);
			}
			catch(error) {
				reject(error);
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
				else if(self.running.has(job)) {
					job.attempts.cancel();
					self.running.delete(job);
				}
			});
		});
	}

	async destroy() {
		this.removeEvent();
	}
}

export default JobsQueue;
