module.exports = {
  name: 'hello',
  description: 'Says hello!',
  execute(message, args) {
    message.channel.send('Hello!');
  },
};

