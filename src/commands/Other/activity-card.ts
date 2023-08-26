import { Command, type ChatInputCommand } from '@sapphire/framework';
import { ApplyOptions } from '@sapphire/decorators';
import {
	type ApplicationCommandOptionData,
	ApplicationCommandOptionType,
	ContextMenuCommandInteraction,
	GuildMember,
	AttachmentBuilder,
	ApplicationCommandType
} from 'discord.js';
import { getGuildSettings, getUserPoints } from '#lib/util/database';
import ActivityCard from '#lib/htmltoimage/TypicalCard/ActivityCard';

@ApplyOptions<ChatInputCommand.Options>({
	description: 'Fetch an activity card.'
})
export class ActivtyCardCommand extends Command {
	readonly commandOptions: ApplicationCommandOptionData[] = [
		{
			type: ApplicationCommandOptionType.User,
			name: 'member',
			description: "The member you'd like fetch an activity card for.",
			required: false
		}
	];

	public override registerApplicationCommands(registry: ChatInputCommand.Registry) {
		registry
			.registerChatInputCommand({
				name: this.name,
				description: this.description,
				options: this.commandOptions,
				dmPermission: false
			})
			.registerContextMenuCommand({
				name: 'Get Activity Card',
				type: ApplicationCommandType.User
			});
	}

	private async getRank(serverId: string, userId: string, range: number = 0): Promise<any> {
		const USERPOINTS = await getUserPoints(userId, serverId, false);
		if (!USERPOINTS) return 0;

		let { data, error } = await this.container.database.client
			.from('points')
			.select('*')
			.eq('server_id', serverId)
			.order('amount', { ascending: false })
			.range(range, range + 2500);

		if (error) return 0;

		const INDEX = data?.findIndex(({ user_id }) => user_id === userId);
		if (INDEX === undefined || INDEX === -1) {
			return await this.getRank(serverId, userId, range + 2500);
		}

		return INDEX + range + 1;
	}

	private async activityCard(interaction: ChatInputCommand.Interaction | ContextMenuCommandInteraction, member: GuildMember) {
		if (!interaction.guild) return;
		if (member.user.bot) return;

		const GUILDSETTINGS = await getGuildSettings(interaction.guild.id);
		if (!GUILDSETTINGS?.points_system) {
			return interaction.reply({
				ephemeral: true,
				content: 'Activity system is not enabled for this guild.'
			});
		}

		const USERPOINTS = await getUserPoints(member.id, interaction.guild.id, false);
		if (!USERPOINTS) {
			return interaction.reply({
				ephemeral: true,
				content: 'This user does not have any activity poitns!'
			});
		};

		await interaction.deferReply({ fetchReply: true });

		const PROGRESS = {
			title: '',
			points: {
				currentProgress: 0,
				nextRequired: 0
			}
		};
		for (let [points, roleId] of GUILDSETTINGS.activity_roles) {
			PROGRESS.points.nextRequired += points;

			if (USERPOINTS.amount >= PROGRESS.points.nextRequired) {
				const ROLE = await interaction.guild.roles.fetch(roleId);
				if (!ROLE) return;

				PROGRESS.title = ROLE.name;

				continue;
			}

			if (USERPOINTS.amount <= PROGRESS.points.nextRequired) {
				PROGRESS.points.currentProgress = PROGRESS.points.nextRequired;
				PROGRESS.points.nextRequired += points;

				break;
			}
		}

		const ACTIVITYCARD = await new ActivityCard(
			{
				name: member.user.username,
				avatarURL: member.displayAvatarURL({ forceStatic: true, size: 512 }) || member.user.defaultAvatarURL,
				status: member.presence?.status
			},
			{
				title: PROGRESS.title,
				rank: await this.getRank(interaction.guild.id, member.id),
				points: {
					total: USERPOINTS.amount,
					currentProgress: PROGRESS.points.currentProgress - USERPOINTS.amount,
					nextProgress: PROGRESS.points.nextRequired - PROGRESS.points.currentProgress
				}
			}
		).draw();
		if (!ACTIVITYCARD) return;

		const ATTACHMENT = new AttachmentBuilder(ACTIVITYCARD, { name: 'card.png' });
		return interaction.editReply({
			files: [ATTACHMENT]
		});
	}

	public override async chatInputRun(interaction: ChatInputCommand.Interaction) {
		let member: GuildMember | undefined;

		if (interaction.options.get('member')) {
			member = await interaction.guild?.members.fetch(interaction.options.getUser('member')?.id || '').catch(() => undefined);
		} else {
			member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => undefined);
		}

		if (!member) {
			return interaction.reply({
				ephemeral: true,
				content: `I was unable to fetch this activity card.`
			});
		}

		return this.activityCard(interaction, member);
	}

	public override async contextMenuRun(interaction: ContextMenuCommandInteraction) {
		const MEMBER = await interaction.guild?.members.fetch(interaction.targetId).catch(() => null);
		if (!MEMBER) {
			return interaction.reply({
				ephemeral: true,
				content: `I was unable to fetch <@${interaction.targetId}>\'s activity card.`
			});
		}

		return this.activityCard(interaction, MEMBER);
	}
}
