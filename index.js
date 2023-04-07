console.log("Starting Discord-Twitch-Notifier Service")

var userConfig = {
    accounts: [],
}

const fs = require("fs")

const config = require("./config")
const Discord = require("discord.js")
var twitchAPI = require("twitch-api-v5")
const { channel } = require("diagnostics_channel")

twitchAPI.clientID = config.twitch.clientID

const client = new Discord.Client()

const commandPrefix = "!"

var pendingUsers = []

function readUserConfigFile() {
    if (fs.existsSync("./userconfig.json"))
        userConfig = JSON.parse(fs.readFileSync("./userconfig.json", "utf8"))
}

function writeUserConfigFile() {
    fs.writeFileSync("./userconfig.json", JSON.stringify(userConfig), "utf8")
}

readUserConfigFile()

function getStreamToken(stream) {
    return Date.parse(stream.created_at) + "-" + encodeURIComponent(stream.game)
}

function convertMessage(input, stream) {
    const matches = {
        "%game%": stream.game,
        "%displayName%": stream.channel.display_name,
        "%status%": stream.channel.status,
        "%url%": stream.channel.url,
        "%description%": stream.channel.description,
    }

    return input.replace(
        new RegExp(Object.keys(matches).join("|"), "gi"),
        (matched) => matches[matched]
    )
}

function checkStreams() {
    var date = new Date()

    console.log(date.toTimeString() + ": Checking streams...")
    userConfig.accounts.forEach((user) => {
        twitchAPI.streams.channel({ channelID: user.id }, (error, result) => {
            if (!error) {
                if (typeof user.lastMessage == "undefined") {
                    user.lastMessage = Date.now()
                    writeUserConfigFile()
                }

                if (result.stream != null) {
                    const streamToken = getStreamToken(result.stream)

                    if (user.currentStreamToken !== streamToken) {
                        user.isLive = true
                        user.currentStreamToken = streamToken

                        const changedGame =
                            user.currentStreamStart === result.stream.created_at

                        user.currentStreamStart = result.stream.created_at

                        client.channels
                            .fetch(user.channel)
                            .then((channel) =>
                                channel.send(
                                    convertMessage(
                                        changedGame
                                            ? user.changeMessage || user.message
                                            : user.message,
                                        result.stream
                                    )
                                )
                            )

                        if (changedGame)
                            console.log(
                                `${date.toTimeString()}: ${
                                    user.displayName
                                } changed game to ${result.stream.game}`
                            )
                        else
                            console.log(
                                `${date.toTimeString()}: ${
                                    user.displayName
                                } is live with ${result.stream.game}`
                            )

                        writeUserConfigFile()
                    }
                } else if (result.stream == null && user.isLive) {
                    user.isLive = false
                    writeUserConfigFile()

                    console.log(
                        `${date.toTimeString()}: ${
                            user.displayName
                        } is no longer live`
                    )
                }
            }
        })
    })
}

client.on("message", function (message) {
    if (message.author.bot) return
    if (!message.member.hasPermission("ADMINISTRATOR")) return
    if (!message.content.startsWith(commandPrefix)) return

    const commandBody = message.content.slice(commandPrefix.length)
    const args = commandBody.split(" ")
    const command = args.shift().toLowerCase()

    const botCommand = config.discord.botCommand

    if (command == botCommand) {
        if (args.length == 0) {
            message.reply(
                `Вот все команды для бота:

                !${botCommand} Список twitch - список пользователей Twitch
                !${botCommand} twitch add [имя пользователя] [сообщение...] - Добавить пользователя Twitch (С начальным сообщением)
                !${botCommand} twitch edit-start [имя пользователя] [сообщение...] - Редактирование стартового сообщения для нового потока для пользователей Twitch.
                !${botCommand} twitch edit-change [имя пользователя] [сообщение...] - Редактирование сообщения для изменения игры для пользователей Twitch.
                !${botCommand} twitch remove [имя пользователя] - Удалить пользователя Twitch
                
                Совет: Используйте следующие переменные для сообщений:
                %game%: Текущая игра
                %displayName%: Отображаемое имя
                %status%: Статус
                %description%: Описание канала
                %url%: Twitch-URL`.replace(/  +/g, "")
            )
        } else {
            if (args[0] == "twitch" && args.length > 1) {
                if (args[1] == "list") {
                    var response = `У меня ${userConfig.accounts.length} аккаунты(ы) найден(ы)\n`
                    userConfig.accounts.forEach((account) => {
                        response += `${account.displayName} (${account.name}) с сообщением "${account.message}"\n`
                    })

                    message.reply(response)
                } else if (args[1] == "add") {
                    if (args.length < 4)
                        message.reply(
                            `Пожалуйста, введите имя пользователя. !${botCommand} twitch add [имя пользователя] [сообщение...].`
                        )
                    else {
                        message.reply(
                            `Я ищу учетные записи с именем пользователя ${args[2]}...`
                        )

                        twitchAPI.users.usersByName(
                            { users: args[2] },
                            (error, result) => {
                                if (error)
                                    message.channel.send(
                                        "Во время поиска произошла ошибка."
                                    )
                                else {
                                    var response = `У меня ${result._total} аккаунты(ы) найден(ы):\n\n`
                                    var index = 1

                                    result.users.forEach((user) => {
                                        response += `${index}. ${user.display_name} (${user.name})\n`
                                        index++

                                        pendingUsers.push({
                                            displayName: user.display_name,
                                            name: user.name,
                                            id: user._id,
                                            channel: message.channel.id,
                                            message: args.slice(3).join("123 "),
                                            creator: message.author.id,
                                            isLive: false,
                                            currentStreamStart: null,
                                            currentStreamToken: null,
                                        })
                                    })

                                    response += `\nКогда нужный пользователь появится в списке, введите !${botCommand} twitch confirm [username]. Используйте имя пользователя в скобках. После этого в списке появятся все стримы.`
                                }

                                message.channel.send(response);
                            }
                        )
                    }
                } else if (args[1] == "edit-start") {
                    if (args.length < 4)
                        message.reply(
                            `Пожалуйста, введите ваше имя пользователя. !${botCommand} twitch edit-start [имя пользователя] [сообщение...].`
                        )
                    else {
                        var target = userConfig.accounts.findIndex(
                            (user) => user.name == args[2]
                        )
                        if (target != -1) {
                            userConfig.accounts[target].message = args
                                .slice(3)
                                .join(" ")
                            writeUserConfigFile()
                            message.reply(
                                `Я отредактировал первое сообщение для пользователя ${args[2]}.`
                            )
                        } else {
                            message.reply(
                                `Я не смог найти пользователя ${args[2]} .`
                            )
                        }
                    }
                } else if (args[1] == "edit-change") {
                    if (args.length < 4)
                        message.reply(
                            `Пожалуйста, введите имя пользователя. !${botCommand} twitch edit-change [имя пользователя] [сообщение...].`
                        )
                    else {
                        var target = userConfig.accounts.findIndex(
                            (user) => user.name == args[2]
                        )
                        if (target != -1) {
                            userConfig.accounts[target].changeMessage = args
                                .slice(3)
                                .join(" ")
                            writeUserConfigFile()
                            message.reply(
                                `Я отредактировал сообщение об изменении для пользователя ${args[2]}.`
                            )
                        } else {
                            message.reply(
                                `Я не смог найти пользователя ${args[2]}.`
                            )
                        }
                    }
                } else if (args[1] == "confirm" && args.length >= 3) {
                    const username = args[2]
                    var pendingUser = null

                    pendingUsers.forEach((user) => {
                        if (
                            user.name == username &&
                            user.creator == message.author.id
                        )
                            pendingUser = user
                    })

                    if (pendingUser == null)
                        message.reply(
                            "Я не смог найти пользователя с таким именем."
                        )
                    else {
                        userConfig.accounts.push(pendingUser)
                        writeUserConfigFile()

                        pendingUsers = pendingUsers.filter(
                            (user) => user.creator != message.author.id
                        )

                        message.reply(
                            `Я добавил пользователя ${pendingUser.displayName} (${pendingUser.name}).`
                        )

                        checkStreams()
                    }
                } else if (args[1] == "remove") {
                    if (args.length < 3)
                        message.reply(
                            `Пожалуйста, введите имя пользователя. !${botCommand} twitch remove [username]`
                        )
                    else {
                        var target = userConfig.accounts.findIndex(
                            (user) => user.name == args[2]
                        )
                        if (target != -1) {
                            userConfig.accounts.splice(target, 1)
                            writeUserConfigFile()
                            message.reply(
                                `Я удалил пользователя ${args[2]}.`
                            )
                        } else {
                            message.reply(
                                `Я не смог найти пользователя ${args[2]}.`
                            )
                        }
                    }
                }
            }
        }
    }
})

client.login(config.discord.botToken)
client.on("ready", () => {
    checkStreams()
    setInterval(checkStreams, config.refreshInterval)
})
